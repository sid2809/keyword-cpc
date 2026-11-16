import "server-only";
import { query } from "./db";
import { generateKeywordHistoricalMetrics, type HistoricalResult } from "./google-ads";
import { chunk } from "./keywords";
import { ProjectError } from "./projects";
import { CHUNK_SIZE } from "./runner";
import type { RunSettings } from "./types";

/**
 * "Refresh numbers" for project entries: ask Google again and store the
 * answer as a new fetch (older fetches are kept).
 *
 * Entries are grouped by the settings they were fetched under; each group is
 * sent CHUNK_SIZE keywords at a time, so the cost is one request per 5,000
 * keywords per distinct settings. Requests share the process-wide 1/second
 * limit with runs and breakdowns. Always asks Google (no cache): the point
 * of a refresh is a new answer.
 */

export type ProjectJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  entries: number;
  requestsDone: number;
  requestsTotal: number;
  error: string | null;
};

type Entry = { id: string; keyword_key: string; settings_hash: string; settings: Partial<RunSettings> };

/** Requests needed to refresh these entries: per settings group, one per CHUNK_SIZE. */
export async function refreshRequestCount(entryIds: string[]): Promise<number> {
  if (entryIds.length === 0) return 0;
  const rows = await query<{ n: number }>(
    "select count(*)::int as n from project_keywords where id = any($1::bigint[]) group by settings_hash",
    [entryIds],
  );
  return rows.reduce((sum, r) => sum + Math.ceil(r.n / CHUNK_SIZE), 0);
}

const ALREADY_RUNNING = "A refresh is already running for this project.";

const running = globalThis as unknown as { __kcpcProjectJobs?: Set<string> };
const inFlight = () => (running.__kcpcProjectJobs ??= new Set());

export async function startProjectRefresh(projectId: string, entryIds: string[]): Promise<ProjectJob> {
  if (entryIds.length === 0) throw new ProjectError("No keywords to refresh.");
  const active = await query<{ id: string }>(
    "select id from project_jobs where project_id = $1 and status in ('queued', 'running') limit 1",
    [projectId],
  );
  if (active[0]) throw new ProjectError(ALREADY_RUNNING);

  const total = await refreshRequestCount(entryIds);
  let jobId: string;
  try {
    const rows = await query<{ id: string }>(
      "insert into project_jobs (project_id, entry_ids, requests_total) values ($1, $2::bigint[], $3) returning id",
      [projectId, entryIds, total],
    );
    jobId = rows[0].id;
  } catch (err) {
    // Two starts at the same moment: the unique index lets only one through.
    if ((err as { code?: string }).code === "23505") throw new ProjectError(ALREADY_RUNNING);
    throw err;
  }
  void runProjectRefresh(jobId);
  return { id: jobId, status: "queued", entries: entryIds.length, requestsDone: 0, requestsTotal: total, error: null };
}

/** The project's newest job if it is active or failed in the last 10 minutes. */
export async function getProjectJob(projectId: string): Promise<ProjectJob | null> {
  const rows = await query<{
    id: string;
    status: ProjectJob["status"];
    n: number;
    requests_done: number;
    requests_total: number;
    error: string | null;
  }>(
    `select id, status, cardinality(entry_ids) as n, requests_done, requests_total, error
       from project_jobs
      where project_id = $1
        and (status in ('queued', 'running') or (status = 'failed' and updated_at > now() - interval '10 minutes'))
      order by created_at desc limit 1`,
    [projectId],
  );
  const r = rows[0];
  return r
    ? { id: r.id, status: r.status, entries: r.n, requestsDone: r.requests_done, requestsTotal: r.requests_total, error: r.error }
    : null;
}

/**
 * Runs a job to the end. Each pass takes the next batch of entries that have
 * no fetch newer than the job, so a restarted job continues with what is left
 * and never asks for the same entry twice.
 */
export async function runProjectRefresh(jobId: string): Promise<void> {
  if (inFlight().has(jobId)) return;
  inFlight().add(jobId);
  try {
    const jobs = await query<{ id: string; status: string }>("select id, status from project_jobs where id = $1", [jobId]);
    if (!jobs[0] || jobs[0].status === "done") return;
    await query("update project_jobs set status = 'running', error = null, updated_at = now() where id = $1", [jobId]);

    for (;;) {
      // One settings group at a time, CHUNK_SIZE entries of it.
      const batch = await query<Entry>(
        `with pending as (
           select pk.id, pk.keyword_key, pk.settings_hash, pk.settings
             from project_jobs j
             join project_keywords pk on pk.id = any(j.entry_ids) and pk.project_id = j.project_id
            where j.id = $1
              and not exists (select 1 from project_keyword_fetches f
                               where f.project_keyword_id = pk.id and f.fetched_at >= j.created_at)
         )
         select * from pending
          where settings_hash = (select settings_hash from pending order by settings_hash limit 1)
          order by id limit $2`,
        [jobId, CHUNK_SIZE],
      );
      if (batch.length === 0) break;

      const s = batch[0].settings;
      const settings: RunSettings = {
        geoTargetConstants: s.geoTargetConstants ?? [],
        language: s.language ?? null,
        network: s.network === "GOOGLE_SEARCH_AND_PARTNERS" ? "GOOGLE_SEARCH_AND_PARTNERS" : "GOOGLE_SEARCH",
        monthsBack: 12,
        includeAdultKeywords: false,
        dedupMode: "intact",
      };
      const results = await generateKeywordHistoricalMetrics(batch.map((e) => e.keyword_key), settings);
      await storeFetches(batch, results);
      await query("update project_jobs set requests_done = requests_done + 1, updated_at = now() where id = $1", [jobId]);
    }

    await query(
      `update projects set updated_at = now() where id = (select project_id from project_jobs where id = $1)`,
      [jobId],
    );
    await query("update project_jobs set status = 'done', updated_at = now() where id = $1", [jobId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[project] refresh job ${jobId} failed:`, message);
    await query("update project_jobs set status = 'failed', error = $2, updated_at = now() where id = $1", [
      jobId,
      message,
    ]).catch(() => {});
  } finally {
    inFlight().delete(jobId);
  }
}

/** Boot hook: continue refresh jobs a restart interrupted. */
export async function resumeInterruptedProjectJobs(): Promise<number> {
  const rows = await query<{ id: string }>(
    "select id from project_jobs where status in ('queued', 'running') order by created_at asc",
  );
  for (const { id } of rows) await runProjectRefresh(id);
  return rows.length;
}

/**
 * One new fetch per requested entry. Google answers per canonical keyword and
 * lists the inputs that collapsed into it; an entry it returned nothing for is
 * stored as no-data. When two results claim a keyword, the one whose own text
 * is that keyword wins (same rule as the runner's cache).
 */
async function storeFetches(entries: Entry[], results: HistoricalResult[]): Promise<void> {
  const byAlias = new Map<string, HistoricalResult>();
  for (const r of results) {
    const canonical = r.text.toLowerCase();
    for (const alias of new Set([canonical, ...r.closeVariants.map((v) => v.toLowerCase())])) {
      const existing = byAlias.get(alias);
      if (!existing || (existing.text.toLowerCase() !== alias && alias === canonical)) byAlias.set(alias, r);
    }
  }
  for (const batch of chunk(entries, 1000)) {
    const values: unknown[] = [];
    const tuples = batch.map((e, i) => {
      const hit = byAlias.get(e.keyword_key);
      const m = hit?.metrics ?? null;
      values.push(
        e.id,
        hit?.text ?? null,
        m === null,
        m?.avgMonthlySearches ?? null,
        m?.highTopOfPageBidMicros ?? null,
        m?.lowTopOfPageBidMicros ?? null,
        m?.averageCpcMicros ?? null,
        m?.competition ?? null,
        m?.competitionIndex ?? null,
        m ? JSON.stringify(m.monthlyVolumes) : null,
      );
      const b = i * 10;
      return `($${b + 1}, now(), $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb)`;
    });
    await query(
      `insert into project_keyword_fetches
         (project_keyword_id, fetched_at, canonical_text, no_data, avg_monthly_searches, high_top_micros,
          low_top_micros, average_cpc_micros, competition, competition_index, monthly_volumes)
       values ${tuples.join(", ")}`,
      values,
    );
  }
}
