import "server-only";
import { getPool, query } from "./db";
import {
  generateKeywordHistoricalMetrics,
  type HistoricalResult,
  MAX_KEYWORDS_PER_REQUEST,
} from "./google-ads";
import { chunk, distinctNormalized, type ParsedKeyword } from "./keywords";
import { settingsHash, withDefaults } from "./run-settings";
import type { RunSettings, RunSource, RunStatus } from "./types";

export type { RunSource, RunStatus };

/**
 * In-process run executor. Single user, so no external queue — but runs must
 * survive a restart, which is what `runs.chunk_cursor` is for.
 *
 * Chunk boundaries are derived deterministically from `run_keywords` ordered by
 * position, so a resumed run rebuilds exactly the chunks it started with and
 * `chunk_cursor` keeps meaning "chunks 0..cursor-1 are done".
 */

/**
 * 5,000 rather than the 10,000 cap: quota is charged per request, so a larger
 * chunk is cheaper, but a 10,000-row response is a big payload to hold and the
 * progress bar would barely move. See VERIFIED.md §6.
 */
export const CHUNK_SIZE = 5_000;


export type RunRow = {
  id: string;
  created_at: Date;
  name: string | null;
  tag: string | null;
  source: RunSource;
  settings: RunSettings;
  status: RunStatus;
  total_keywords: number;
  processed: number;
  chunk_cursor: number;
  saved_forever: boolean;
  error: string | null;
  bypass_cache: boolean;
  refreshed_at: Date | null;
  refresh_count: number;
};

// --- creating a run ---------------------------------------------------------

export async function createRun(input: {
  keywords: ParsedKeyword[];
  settings?: Partial<RunSettings>;
  name?: string | null;
  tag?: string | null;
  source: RunSource;
}): Promise<string> {
  const settings = withDefaults(input.settings);
  if (input.keywords.length === 0) throw new Error("Cannot create a run with no keywords");

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows } = await client.query<{ id: string }>(
      `insert into runs (name, tag, source, settings, status, total_keywords)
       values ($1, $2, $3, $4, 'queued', $5)
       returning id`,
      [
        input.name ?? null,
        input.tag ?? null,
        input.source,
        JSON.stringify(settings),
        distinctNormalized(input.keywords).length,
      ],
    );
    const runId = rows[0].id;

    // Bulk insert every submitted row, duplicates included — "keep my list
    // intact" mode replays these verbatim.
    const CopyBatch = 1_000;
    for (const batch of chunk(input.keywords, CopyBatch)) {
      const values: unknown[] = [];
      const tuples = batch.map((k, i) => {
        values.push(runId, k.submitted, k.position);
        return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
      });
      await client.query(
        `insert into run_keywords (run_id, submitted_text, position) values ${tuples.join(", ")}`,
        values,
      );
    }

    await client.query("commit");
    return runId;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const rows = await query<RunRow>("select * from runs where id = $1", [runId]);
  return rows[0] ?? null;
}

// --- executing a run --------------------------------------------------------

export type ProgressEvent = {
  runId: string;
  chunkIndex: number;
  totalChunks: number;
  processed: number;
  total: number;
  fromCache: number;
  fromApi: number;
};

/**
 * Runs (or resumes) a run to completion. Safe to call on a run that is already
 * partway through: it picks up at `chunk_cursor`.
 */
export async function executeRun(
  runId: string,
  onProgress?: (e: ProgressEvent) => void,
): Promise<RunRow> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === "done") return run;
  if (run.status === "canceled") return run;

  const settings = withDefaults(run.settings);
  const hash = settingsHash(settings);

  // Rebuild the exact keyword ordering the run was created with.
  const submitted = await query<{ submitted_text: string; position: number }>(
    "select submitted_text, position from run_keywords where run_id = $1 order by position asc",
    [runId],
  );
  const parsed: ParsedKeyword[] = submitted.map((r) => ({
    submitted: r.submitted_text,
    normalized: r.submitted_text.toLowerCase(),
    position: r.position,
  }));
  const unique = distinctNormalized(parsed);
  const chunks = chunk(unique, CHUNK_SIZE);

  await query("update runs set status = 'running', updated_at = now(), error = null where id = $1", [runId]);

  try {
    for (let i = run.chunk_cursor; i < chunks.length; i++) {
      const batch = chunks[i];

      // Cache first — Google refreshes this data monthly, so a payload fetched
      // in the current calendar month is still current. A refresh sets
      // bypass_cache, because re-serving the cached payload would make every
      // delta zero and the whole action pointless.
      const cached = run.bypass_cache ? new Map<string, HistoricalResult>() : await readCache(batch, hash);
      const missing = batch.filter((k) => !cached.has(k));

      let fetched: HistoricalResult[] = [];
      if (missing.length > 0) {
        if (missing.length > MAX_KEYWORDS_PER_REQUEST) {
          throw new Error(
            `Chunk ${i} has ${missing.length} uncached keywords, over the ${MAX_KEYWORDS_PER_REQUEST} cap`,
          );
        }
        fetched = await generateKeywordHistoricalMetrics(missing, settings);
        await writeCache(fetched, hash);
      }

      const results = [...cached.values(), ...fetched];
      await persistChunk(runId, batch, results);

      await query(
        `update runs
            set chunk_cursor = $2,
                processed = least($3, total_keywords),
                updated_at = now()
          where id = $1`,
        [runId, i + 1, Math.min((i + 1) * CHUNK_SIZE, unique.length)],
      );

      onProgress?.({
        runId,
        chunkIndex: i,
        totalChunks: chunks.length,
        processed: Math.min((i + 1) * CHUNK_SIZE, unique.length),
        total: unique.length,
        fromCache: cached.size,
        fromApi: fetched.length,
      });
    }

    await query(
      `update runs
          set status = 'done', processed = total_keywords, bypass_cache = false,
              updated_at = now()
        where id = $1`,
      [runId],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // chunk_cursor is left where it was, so a retry resumes rather than restarts.
    await query("update runs set status = 'failed', error = $2, updated_at = now() where id = $1", [
      runId,
      message,
    ]);
    throw err;
  }

  return (await getRun(runId))!;
}

// --- cache ------------------------------------------------------------------

/**
 * Returns cached payloads for keywords fetched during the current calendar
 * month. Anything older is treated as a miss — Google refreshes monthly.
 */
async function readCache(keywords: string[], hash: string): Promise<Map<string, HistoricalResult>> {
  const out = new Map<string, HistoricalResult>();
  if (keywords.length === 0) return out;

  const rows = await query<{ canonical_text: string; payload: HistoricalResult }>(
    `select canonical_text, payload
       from metrics_cache
      where settings_hash = $1
        and canonical_text = any($2::text[])
        and date_trunc('month', fetched_at) = date_trunc('month', now())`,
    [hash, keywords],
  );

  for (const r of rows) out.set(r.canonical_text, r.payload);
  return out;
}

async function writeCache(results: HistoricalResult[], hash: string): Promise<void> {
  if (results.length === 0) return;

  // Cache under every alias so a later run submitting "Cars" hits the same row.
  const entries: { key: string; payload: HistoricalResult }[] = [];
  for (const r of results) {
    const aliases = new Set<string>([r.text.toLowerCase(), ...r.closeVariants.map((v) => v.toLowerCase())]);
    for (const alias of aliases) entries.push({ key: alias, payload: r });
  }

  for (const batch of chunk(entries, 500)) {
    const values: unknown[] = [];
    const tuples = batch.map((e, i) => {
      values.push(e.key, hash, JSON.stringify(e.payload));
      return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb, now())`;
    });
    await query(
      `insert into metrics_cache (canonical_text, settings_hash, payload, fetched_at)
       values ${tuples.join(", ")}
       on conflict (canonical_text, settings_hash)
       do update set payload = excluded.payload, fetched_at = excluded.fetched_at`,
      values,
    );
  }
}

// --- persistence ------------------------------------------------------------

/**
 * Writes one chunk's metrics and maps every submitted keyword in the chunk onto
 * the canonical row Google collapsed it into.
 */
async function persistChunk(
  runId: string,
  batch: string[],
  results: HistoricalResult[],
): Promise<void> {
  // submitted(normalized) -> canonical. Built from text ∪ closeVariants, which
  // VERIFIED.md §6 shows covers every input we sent.
  const canonicalFor = new Map<string, string>();
  for (const r of results) {
    const canonical = r.text;
    canonicalFor.set(canonical.toLowerCase(), canonical);
    for (const variant of r.closeVariants) canonicalFor.set(variant.toLowerCase(), canonical);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    // One metrics row per canonical keyword. Re-running a chunk overwrites
    // rather than duplicating, which is what makes resume idempotent.
    const metricRows = dedupeByCanonical(results);
    for (const group of chunk(metricRows, 500)) {
      const values: unknown[] = [];
      const tuples = group.map((r, i) => {
        const m = r.metrics;
        values.push(
          runId,
          r.text,
          m?.averageCpcMicros ?? null,
          m?.avgMonthlySearches ?? null,
          m?.competition ?? null,
          m?.competitionIndex ?? null,
          m?.lowTopOfPageBidMicros ?? null,
          m?.highTopOfPageBidMicros ?? null,
          m ? JSON.stringify(m.monthlyVolumes) : null,
          r.noData,
        );
        const b = i * 10;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::jsonb, $${b + 10})`;
      });

      await client.query(
        `insert into keyword_metrics
           (run_id, canonical_text, average_cpc_micros, avg_monthly_searches, competition,
            competition_index, low_top_micros, high_top_micros, monthly_volumes, no_data)
         values ${tuples.join(", ")}
         on conflict (run_id, canonical_text) do update set
           average_cpc_micros   = excluded.average_cpc_micros,
           avg_monthly_searches = excluded.avg_monthly_searches,
           competition          = excluded.competition,
           competition_index    = excluded.competition_index,
           low_top_micros       = excluded.low_top_micros,
           high_top_micros      = excluded.high_top_micros,
           monthly_volumes      = excluded.monthly_volumes,
           no_data              = excluded.no_data`,
        values,
      );
    }

    // Map submitted rows onto their canonical form. Anything in this chunk that
    // Google never mentioned is mapped to itself and will read as no-data.
    const pairs = batch.map((normalized) => [normalized, canonicalFor.get(normalized) ?? normalized] as const);
    for (const group of chunk(pairs, 500)) {
      const values: unknown[] = [runId];
      const tuples = group.map(([normalized, canonical], i) => {
        values.push(normalized, canonical);
        return `($${i * 2 + 2}, $${i * 2 + 3})`;
      });
      await client.query(
        `update run_keywords rk
            set canonical_text = m.canonical
           from (values ${tuples.join(", ")}) as m(normalized, canonical)
          where rk.run_id = $1
            and lower(rk.submitted_text) = m.normalized`,
        values,
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Guards against the API ever returning two rows with the same canonical text. */
function dedupeByCanonical(results: HistoricalResult[]): HistoricalResult[] {
  const byText = new Map<string, HistoricalResult>();
  for (const r of results) {
    const existing = byText.get(r.text);
    // Prefer a row that actually carries metrics.
    if (!existing || (existing.noData && !r.noData)) byText.set(r.text, r);
  }
  return [...byText.values()];
}

// --- resume-on-restart ------------------------------------------------------

/**
 * Picks up runs left mid-flight by a crash or restart. Called from
 * instrumentation.ts at boot.
 */
export async function resumeInterruptedRuns(
  onProgress?: (e: ProgressEvent) => void,
): Promise<string[]> {
  const stale = await query<{ id: string }>(
    "select id from runs where status in ('running', 'queued') order by created_at asc",
  );

  const resumed: string[] = [];
  for (const { id } of stale) {
    try {
      await executeRun(id, onProgress);
      resumed.push(id);
    } catch (err) {
      // executeRun has already marked the run failed with the message; keep
      // going so one bad run doesn't block the rest.
      console.error(`[runner] failed to resume run ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return resumed;
}
