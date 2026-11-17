import "server-only";
import { getPool, query } from "./db";
import { generateKeywordIdeas, GoogleAdsError, type IdeaSeed, type KeywordIdea, type KeywordIdeasResult } from "./google-ads";
import { isRunId } from "./ids";
import { chunk, tidy, normalizeSubmitted } from "./keywords";
import { withDefaults } from "./run-settings";
import { getRun, type RunRow } from "./runner";
import type { RunSettings } from "./types";

/**
 * Discover: new keywords from seeds, via Google's keyword-ideas request.
 *
 * One request per seed (more only when a seed has over 10,000 ideas), because
 * Google's reply does not say which seed produced an idea (VERIFIED.md §9).
 * The ideas are stored as an ordinary "intact" run — one run_keywords row per
 * (seed, idea), numbers in keyword_metrics — so everything that works on a run
 * works on a discovery. The same idea under two seeds is two rows sharing one
 * metrics row.
 *
 * Always asks Google: ideas are not read from or written to metrics_cache.
 */

export type SeedKind = IdeaSeed["kind"];

export type SeedInput = { kind: SeedKind; keyword: string | null; target: string | null };

export type RunSeed = SeedInput & {
  position: number;
  status: "pending" | "done" | "failed";
  ideasTotal: number | null;
  ideasKept: number;
  truncated: boolean;
  error: string | null;
};

export class DiscoverError extends Error {}

/** Each seed costs at least one request at 1 per second; this keeps a discovery to minutes. */
export const MAX_SEEDS = 500;
export const MAX_IDEA_LIMIT = 1_000_000;
const MAX_KEYWORD_CHARS = 500;
const MAX_URL_CHARS = 2_000;
/** Seed n owns positions n*SPAN .. n*SPAN+SPAN-1, so rows stay in seed order and a seed can be rewritten alone. */
const POSITION_SPAN = 1_000_000;

// --- input ------------------------------------------------------------------

function cleanUrl(raw: unknown): string | null {
  const text = tidy(typeof raw === "string" ? raw : "");
  if (text === "" || text.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A site seed is a bare host ("www.example.com"); scheme, path and port are dropped. */
function cleanSite(raw: unknown): string | null {
  const url = cleanUrl(raw);
  return url ? new URL(url).hostname.toLowerCase() : null;
}

function cleanKeyword(raw: unknown): string | null {
  const text = normalizeSubmitted(typeof raw === "string" ? raw : "").slice(0, MAX_KEYWORD_CHARS);
  return text === "" ? null : text;
}

/**
 * Validates seeds from a request body. Throws DiscoverError naming the first
 * unusable line (1-based), so nothing is silently dropped. Exact repeats are
 * removed: asking the same thing twice would only spend a request.
 */
export function parseSeeds(raw: unknown): SeedInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new DiscoverError("Add at least one seed.");
  const out: SeedInput[] = [];
  const seen = new Set<string>();

  raw.forEach((item, i) => {
    const line = `Seed ${i + 1}`;
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    let seed: SeedInput;
    switch (o.kind) {
      case "keyword": {
        const keyword = cleanKeyword(o.keyword);
        if (!keyword) throw new DiscoverError(`${line}: the keyword is empty.`);
        seed = { kind: "keyword", keyword, target: null };
        break;
      }
      case "url": {
        const target = cleanUrl(o.target);
        if (!target) throw new DiscoverError(`${line}: that is not a usable page URL.`);
        seed = { kind: "url", keyword: null, target };
        break;
      }
      case "keyword_url": {
        const keyword = cleanKeyword(o.keyword);
        const target = cleanUrl(o.target);
        if (!keyword) throw new DiscoverError(`${line}: the keyword is empty.`);
        if (!target) throw new DiscoverError(`${line}: that is not a usable page URL.`);
        seed = { kind: "keyword_url", keyword, target };
        break;
      }
      case "site": {
        const target = cleanSite(o.target);
        if (!target) throw new DiscoverError(`${line}: that is not a usable website.`);
        seed = { kind: "site", keyword: null, target };
        break;
      }
      default:
        throw new DiscoverError(`${line}: unknown seed type.`);
    }
    const key = `${seed.kind}|${seed.keyword?.toLowerCase() ?? ""}|${seed.target ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(seed);
  });

  if (out.length > MAX_SEEDS) {
    throw new DiscoverError(`At most ${MAX_SEEDS} seeds per discovery; ${out.length} given.`);
  }
  return out;
}

/** null/undefined/"" = no limit. Anything else must be a whole number from 1 to MAX_IDEA_LIMIT. */
export function parseIdeaLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_IDEA_LIMIT) {
    throw new DiscoverError(`The limit must be a whole number from 1 to ${MAX_IDEA_LIMIT.toLocaleString("en-IN")}, or empty for no limit.`);
  }
  return n;
}

function toIdeaSeed(s: SeedInput): IdeaSeed {
  switch (s.kind) {
    case "keyword":
      return { kind: "keyword", keyword: s.keyword! };
    case "url":
      return { kind: "url", url: s.target! };
    case "keyword_url":
      return { kind: "keyword_url", keyword: s.keyword!, url: s.target! };
    case "site":
      return { kind: "site", site: s.target! };
  }
}

// --- create -----------------------------------------------------------------

export async function createDiscovery(input: {
  seeds: SeedInput[];
  settings?: Partial<RunSettings>;
  name?: string | null;
  tag?: string | null;
  limit?: number | null;
}): Promise<string> {
  if (input.seeds.length === 0) throw new DiscoverError("Add at least one seed.");
  // Always "intact": a row per (seed, idea) is what keeps seeds separate.
  const settings = { ...withDefaults(input.settings), dedupMode: "intact" as const };

  const client = await getPool().connect();
  try {
    await client.query("begin");
    // While it runs, progress counts seeds; the totals become idea counts when it finishes.
    const { rows } = await client.query<{ id: string }>(
      `insert into runs (name, tag, source, settings, status, total_keywords, idea_limit)
       values ($1, $2, 'discover', $3, 'queued', $4, $5) returning id`,
      [input.name ?? null, input.tag ?? null, JSON.stringify(settings), input.seeds.length, input.limit ?? null],
    );
    const runId = rows[0].id;
    const values: unknown[] = [];
    const tuples = input.seeds.map((s, i) => {
      values.push(runId, i, s.kind, s.keyword, s.target);
      const b = i * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    await client.query(`insert into run_seeds (run_id, position, kind, keyword, target) values ${tuples.join(", ")}`, values);
    await client.query("commit");
    return runId;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getRunSeeds(runId: string): Promise<RunSeed[]> {
  if (!isRunId(runId)) return [];
  const rows = await query<{
    position: number;
    kind: SeedKind;
    keyword: string | null;
    target: string | null;
    status: RunSeed["status"];
    ideas_total: number | null;
    ideas_kept: number;
    truncated: boolean;
    error: string | null;
  }>(
    `select position, kind, keyword, target, status, ideas_total, ideas_kept, truncated, error
       from run_seeds where run_id = $1 order by position`,
    [runId],
  );
  return rows.map((r) => ({
    position: r.position,
    kind: r.kind,
    keyword: r.keyword,
    target: r.target,
    status: r.status,
    ideasTotal: r.ideas_total,
    ideasKept: r.ideas_kept,
    truncated: r.truncated,
    error: r.error,
  }));
}

// --- execute ----------------------------------------------------------------

/**
 * True while a discovery still has to talk to Google: a seed is pending, or
 * nothing was ever stored (every seed was rejected — resuming must report that
 * again, not fall through to the normal runner and finish as an empty run).
 */
export async function discoveryIsIncomplete(runId: string): Promise<boolean> {
  const rows = await query<{ pending: boolean; stored: boolean }>(
    `select exists (select 1 from run_seeds where run_id = $1 and status = 'pending') as pending,
            exists (select 1 from run_seeds where run_id = $1 and status = 'done') as stored`,
    [runId],
  );
  return rows[0].pending || !rows[0].stored;
}

const running = globalThis as unknown as { __kcpcDiscoveries?: Set<string> };
const inFlight = () => (running.__kcpcDiscoveries ??= new Set());

/**
 * Asks Google for every pending seed, in order, storing each seed's ideas as
 * soon as they arrive. Safe to call again after a restart or a failure: seeds
 * already done are skipped and a half-written seed is rewritten whole.
 *
 * A seed Google rejects as invalid (HTTP 400) is marked failed and the rest
 * carry on. Any other error stops the run with that seed still pending, so a
 * resume retries it.
 */
export async function executeDiscovery(runId: string): Promise<RunRow> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (inFlight().has(runId)) return run;
  inFlight().add(runId);

  try {
    const settings = withDefaults(run.settings);
    const limit = (await query<{ idea_limit: number | null }>("select idea_limit from runs where id = $1", [runId]))[0]
      ?.idea_limit;
    await query("update runs set status = 'running', updated_at = now(), error = null where id = $1", [runId]);

    const seeds = await getRunSeeds(runId);
    for (const seed of seeds) {
      if (seed.status !== "pending") continue;
      let result: KeywordIdeasResult;
      try {
        result = await generateKeywordIdeas(toIdeaSeed(seed), settings, limit ? { limit } : {});
      } catch (err) {
        if (err instanceof GoogleAdsError && err.status === 400) {
          await query(
            "update run_seeds set status = 'failed', error = $3, fetched_at = now() where run_id = $1 and position = $2",
            [runId, seed.position, err.message],
          );
          await bumpProgress(runId);
          continue;
        }
        throw err;
      }
      await persistSeed(runId, seed.position, result);
      await bumpProgress(runId);
    }

    const after = await getRunSeeds(runId);
    if (!after.some((s) => s.status === "done")) {
      const first = after.find((s) => s.error)?.error ?? "no reason given";
      throw new DiscoverError(
        after.length === 1
          ? `Google rejected the seed: ${first}`
          : `Google rejected all ${after.length} seeds. First reason: ${first}`,
      );
    }

    await query("analyze run_keywords, keyword_metrics").catch((err) => {
      console.error(`[discover] analyze after run ${runId} failed:`, err instanceof Error ? err.message : err);
    });
    // From here it is an ordinary run: totals count keywords, as on any run.
    await query(
      `update runs r
          set status = 'done', bypass_cache = false, chunk_cursor = 0, updated_at = now(),
              total_keywords = c.n, processed = c.n
         from (select count(distinct lower(submitted_text))::int as n from run_keywords where run_id = $1) c
        where r.id = $1`,
      [runId],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query("update runs set status = 'failed', error = $2, updated_at = now() where id = $1", [runId, message]);
    throw err;
  } finally {
    inFlight().delete(runId);
  }
  return (await getRun(runId))!;
}

/** Progress while discovering = seeds dealt with (done or rejected) out of all seeds. */
async function bumpProgress(runId: string): Promise<void> {
  await query(
    `update runs set updated_at = now(),
            processed = (select count(*)::int from run_seeds where run_id = $1 and status <> 'pending')
      where id = $1`,
    [runId],
  );
}

/**
 * Stores one seed's ideas in a single transaction: its previous rows (from an
 * interrupted attempt) are removed first, so the seed is either wholly stored
 * and marked done, or untouched.
 */
async function persistSeed(runId: string, seedPosition: number, result: KeywordIdeasResult): Promise<void> {
  // One row per idea text within a seed; prefer a copy that carries metrics.
  const byText = new Map<string, KeywordIdea>();
  for (const idea of result.ideas) {
    const text = tidy(idea.text);
    if (text === "") continue;
    const existing = byText.get(text);
    if (!existing || (existing.noData && !idea.noData)) byText.set(text, { ...idea, text });
  }
  const ideas = [...byText.values()];
  if (ideas.length > POSITION_SPAN) throw new Error(`Seed ${seedPosition + 1} returned over ${POSITION_SPAN} ideas`);

  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("delete from run_keywords where run_id = $1 and seed_position = $2", [runId, seedPosition]);

    for (const group of chunk(ideas, 500)) {
      const values: unknown[] = [];
      const tuples = group.map((idea, i) => {
        const m = idea.metrics;
        values.push(
          runId,
          idea.text,
          m?.averageCpcMicros ?? null,
          m?.avgMonthlySearches ?? null,
          m?.competition ?? null,
          m?.competitionIndex ?? null,
          m?.lowTopOfPageBidMicros ?? null,
          m?.highTopOfPageBidMicros ?? null,
          m ? JSON.stringify(m.monthlyVolumes) : null,
          idea.noData,
        );
        const b = i * 10;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::jsonb, $${b + 10})`;
      });
      // The same idea under another seed of this run already has a row; both
      // were asked with the same settings, so overwriting it changes nothing
      // unless this copy has numbers and that one did not.
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
           no_data              = excluded.no_data
         where keyword_metrics.no_data or not excluded.no_data`,
        values,
      );
    }

    for (const [g, group] of chunk(ideas, 1000).entries()) {
      const values: unknown[] = [runId, seedPosition];
      const tuples = group.map((idea, i) => {
        values.push(idea.text, seedPosition * POSITION_SPAN + g * 1000 + i);
        return `($1, $${i * 2 + 3}, $${i * 2 + 3}, $${i * 2 + 4}, $2)`;
      });
      await client.query(
        `insert into run_keywords (run_id, submitted_text, canonical_text, position, seed_position)
         values ${tuples.join(", ")}`,
        values,
      );
    }

    await client.query(
      `update run_seeds
          set status = 'done', error = null, fetched_at = now(),
              ideas_total = $3, ideas_kept = $4, truncated = $5, requests = $6
        where run_id = $1 and position = $2`,
      [runId, seedPosition, result.totalSize, ideas.length, result.truncated, result.requests],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
