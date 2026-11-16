import "server-only";
import { query } from "./db";
import { generateKeywordHistoricalMetrics, type HistoricalResult } from "./google-ads";
import { chunk } from "./keywords";
import { CHUNK_SIZE } from "./runner";
import { countryById } from "./countries";
import { GEO_ALL, GEO_SHORTLIST, type GeoScope } from "./geo-shortlist";
import type { RunSettings } from "./types";

/**
 * Country breakdown: the same keywords asked once per country.
 *
 * Google's historical-metrics call returns one combined figure for whatever
 * locations are sent, so a per-country view costs one request per country
 * (per CHUNK_SIZE keywords). Requests go through generateKeywordHistoricalMetrics
 * and therefore share the process-wide 1 request/second limit with runs.
 *
 * Breakdowns use "Any language" (owner's choice: the point is to find where a
 * keyword is searched, whatever the language) and the caller's network.
 */

export type GeoNetwork = RunSettings["network"];

export type GeoJobRow = {
  id: string;
  keywords: string[];
  network: GeoNetwork;
  scope: GeoScope;
  countries: string[];
  cursor: number;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
};

export type GeoMetricRow = {
  geo: string;
  noData: boolean;
  avgMonthlySearches: number | null;
  highTopMicros: number | null;
  lowTopMicros: number | null;
  averageCpcMicros: number | null;
  competition: string | null;
  competitionIndex: number | null;
};

export const MAX_GEO_KEYWORDS = 50_000;

const FRESH = "date_trunc('month', fetched_at) = date_trunc('month', now())";

export function normalizeGeoKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const k of raw) {
    if (typeof k !== "string") continue;
    const v = k.trim().toLowerCase();
    if (v !== "" && !v.includes("\u0000")) seen.add(v);
  }
  return [...seen];
}

export function isGeoNetwork(v: unknown): v is GeoNetwork {
  return v === "GOOGLE_SEARCH" || v === "GOOGLE_SEARCH_AND_PARTNERS";
}

function settingsFor(geo: string, network: GeoNetwork): RunSettings {
  return {
    geoTargetConstants: [geo],
    language: null,
    network,
    monthsBack: 12,
    includeAdultKeywords: false,
    dedupMode: "intact",
  };
}

// --- jobs -------------------------------------------------------------------

const running = globalThis as unknown as { __kcpcGeoJobs?: Set<string> };
function inFlight(): Set<string> {
  return (running.__kcpcGeoJobs ??= new Set());
}

/**
 * Starts (or joins) a background breakdown. An active job that already covers
 * every requested keyword at this scope is reused, so a double click or a
 * second tab doesn't spend quota twice.
 */
export async function startGeoJob(input: {
  keywords: string[];
  network: GeoNetwork;
  scope: GeoScope;
}): Promise<GeoJobRow> {
  const { keywords, network, scope } = input;
  const existing = await query<GeoJobRow>(
    `select id, keywords, network, scope, countries, cursor, status, error
       from geo_jobs
      where status in ('queued', 'running') and network = $1 and keywords @> $2::text[]
        and (scope = $3 or scope = 'all')
      order by created_at asc limit 1`,
    [network, keywords, scope],
  );
  if (existing[0]) {
    void runGeoJob(existing[0].id);
    return existing[0];
  }

  const countries = (scope === "all" ? GEO_ALL : GEO_SHORTLIST).map((c) => c.id);
  const rows = await query<GeoJobRow>(
    `insert into geo_jobs (keywords, network, scope, countries)
     values ($1::text[], $2, $3, $4::text[])
     returning id, keywords, network, scope, countries, cursor, status, error`,
    [keywords, network, scope, countries],
  );
  void runGeoJob(rows[0].id);
  return rows[0];
}

export async function getGeoJob(id: string): Promise<GeoJobRow | null> {
  const rows = await query<GeoJobRow>(
    "select id, keywords, network, scope, countries, cursor, status, error from geo_jobs where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Works through a job's countries from its cursor. Safe to call repeatedly:
 * a job already running in this process is left alone. Errors are recorded on
 * the job (cursor kept, so a retry resumes) and never thrown to the caller.
 */
export async function runGeoJob(id: string): Promise<void> {
  if (inFlight().has(id)) return;
  inFlight().add(id);
  try {
    const job = await getGeoJob(id);
    if (!job || job.status === "done") return;
    await query("update geo_jobs set status = 'running', error = null, updated_at = now() where id = $1", [id]);

    for (let i = job.cursor; i < job.countries.length; i++) {
      await fetchCountry(job.keywords, job.countries[i], job.network);
      await query("update geo_jobs set cursor = $2, updated_at = now() where id = $1", [id, i + 1]);
    }
    await query("update geo_jobs set status = 'done', updated_at = now() where id = $1", [id]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[geo] job ${id} failed:`, message);
    await query("update geo_jobs set status = 'failed', error = $2, updated_at = now() where id = $1", [
      id,
      message,
    ]).catch(() => {});
  } finally {
    inFlight().delete(id);
  }
}

/** Boot hook: continue jobs a restart interrupted. */
export async function resumeInterruptedGeoJobs(): Promise<number> {
  const rows = await query<{ id: string }>(
    "select id from geo_jobs where status in ('queued', 'running') order by created_at asc",
  );
  for (const { id } of rows) await runGeoJob(id);
  return rows.length;
}

/** Fetches one country for the keywords that have no fresh row there yet. */
async function fetchCountry(keywords: string[], geo: string, network: GeoNetwork): Promise<void> {
  const have = await query<{ keyword: string }>(
    `select keyword from keyword_geo_metrics
      where network = $1 and geo = $2 and keyword = any($3::text[]) and ${FRESH}`,
    [network, geo, keywords],
  );
  const fresh = new Set(have.map((r) => r.keyword));
  const missing = keywords.filter((k) => !fresh.has(k));

  for (const batch of chunk(missing, CHUNK_SIZE)) {
    const results = await generateKeywordHistoricalMetrics(batch, settingsFor(geo, network));
    await store(batch, results, geo, network);
  }
}

/**
 * Writes one row per REQUESTED keyword. Google answers per canonical keyword
 * and lists the inputs that collapsed into it (closeVariants); a keyword it
 * returned nothing for is stored as no_data so it isn't asked again this month.
 * When two results claim a keyword, the one whose own text is that keyword
 * wins (same rule as the runner's cache; close variants are not a partition).
 */
async function store(requested: string[], results: HistoricalResult[], geo: string, network: GeoNetwork) {
  const byAlias = new Map<string, HistoricalResult>();
  for (const r of results) {
    const canonical = r.text.toLowerCase();
    for (const alias of new Set([canonical, ...r.closeVariants.map((v) => v.toLowerCase())])) {
      const existing = byAlias.get(alias);
      if (!existing || (existing.text.toLowerCase() !== alias && alias === canonical)) byAlias.set(alias, r);
    }
  }

  for (const batch of chunk(requested, 1000)) {
    const values: unknown[] = [];
    const tuples = batch.map((keyword, i) => {
      const m = byAlias.get(keyword)?.metrics ?? null;
      values.push(
        keyword,
        network,
        geo,
        m === null,
        m?.avgMonthlySearches ?? null,
        m?.highTopOfPageBidMicros ?? null,
        m?.lowTopOfPageBidMicros ?? null,
        m?.averageCpcMicros ?? null,
        m?.competition ?? null,
        m?.competitionIndex ?? null,
      );
      const b = i * 10;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, now())`;
    });
    await query(
      `insert into keyword_geo_metrics
         (keyword, network, geo, no_data, avg_monthly_searches, high_top_micros, low_top_micros,
          average_cpc_micros, competition, competition_index, fetched_at)
       values ${tuples.join(", ")}
       on conflict (keyword, network, geo) do update set
         no_data = excluded.no_data,
         avg_monthly_searches = excluded.avg_monthly_searches,
         high_top_micros = excluded.high_top_micros,
         low_top_micros = excluded.low_top_micros,
         average_cpc_micros = excluded.average_cpc_micros,
         competition = excluded.competition,
         competition_index = excluded.competition_index,
         fetched_at = excluded.fetched_at`,
      values,
    );
  }
}

// --- reading ----------------------------------------------------------------

export type GeoBreakdown = {
  keyword: string;
  rows: GeoMetricRow[];
  /** Countries scanned this month, out of each list. */
  shortlistScanned: number;
  shortlistTotal: number;
  allScanned: number;
  allTotal: number;
  /** The newest job covering this keyword, if one is active or just failed. */
  job: { id: string; status: GeoJobRow["status"]; scope: GeoScope; done: number; total: number; error: string | null } | null;
};

export async function getGeoBreakdown(keyword: string, network: GeoNetwork): Promise<GeoBreakdown> {
  const raw = await query<{
    geo: string;
    no_data: boolean;
    avg_monthly_searches: string | null;
    high_top_micros: string | null;
    low_top_micros: string | null;
    average_cpc_micros: string | null;
    competition: string | null;
    competition_index: number | null;
  }>(
    `select geo, no_data, avg_monthly_searches, high_top_micros, low_top_micros, average_cpc_micros,
            competition, competition_index
       from keyword_geo_metrics
      where keyword = $1 and network = $2 and ${FRESH}`,
    [keyword, network],
  );
  const num = (v: string | null) => (v === null ? null : Number(v));
  // Only countries still on Google's list (a regenerated list may drop one).
  const rows: GeoMetricRow[] = raw
    .filter((r) => countryById(r.geo))
    .map((r) => ({
      geo: r.geo,
      noData: r.no_data,
      avgMonthlySearches: num(r.avg_monthly_searches),
      highTopMicros: num(r.high_top_micros),
      lowTopMicros: num(r.low_top_micros),
      averageCpcMicros: num(r.average_cpc_micros),
      competition: r.competition,
      competitionIndex: r.competition_index,
    }));

  const scanned = new Set(rows.map((r) => r.geo));
  const jobs = await query<GeoJobRow>(
    `select id, keywords, network, scope, countries, cursor, status, error
       from geo_jobs
      where network = $1 and keywords @> array[$2]::text[]
        and (status in ('queued', 'running') or (status = 'failed' and updated_at > now() - interval '10 minutes'))
      order by created_at desc limit 1`,
    [network, keyword],
  );
  const j = jobs[0];

  return {
    keyword,
    rows,
    shortlistScanned: GEO_SHORTLIST.filter((c) => scanned.has(c.id)).length,
    shortlistTotal: GEO_SHORTLIST.length,
    allScanned: GEO_ALL.filter((c) => scanned.has(c.id)).length,
    allTotal: GEO_ALL.length,
    job: j
      ? { id: j.id, status: j.status, scope: j.scope, done: j.cursor, total: j.countries.length, error: j.error }
      : null,
  };
}
