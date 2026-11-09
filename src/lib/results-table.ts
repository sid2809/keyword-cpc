import "server-only";
import { getPool, query } from "./db";
import { histogramLayout, tertilesFromStats, type Bucket } from "./heat";
import type { DedupMode, MonthlyVolume, ResultRow, ResultsOverview, ResultsPage } from "./types";

export type { ResultsOverview, ResultsPage };
import {
  defaultSort,
  type ResultsFilters,
  type ResultsQuery,
  type SortState,
} from "./results-params";

/**
 * The results table, served one page at a time from Postgres.
 *
 * Every filter and sort here reproduces what results-view.tsx used to do in the
 * browser over the full row list — same predicates, same null handling, same
 * tie-breaking — so moving the work server-side changes how much data travels,
 * not which rows appear or in what order. The equivalence was checked against
 * the previous client-side code on a 125,000-keyword run.
 *
 * Alphabetical order and case-insensitive search use the `keyword_order` ICU
 * collation created in migration 005, which reproduces the browser's
 * localeCompare and toLowerCase (see that migration for how it was checked).
 */

// --- the row source ---------------------------------------------------------

/**
 * One SQL row per table row, in either dedup mode. `$1` is the run id.
 *
 *   intact  — one row per submitted keyword; metrics joined by canonical text.
 *             A keyword whose canonical form has no metrics row reads as
 *             no-data with no canonical, as before.
 *   deduped — one row per canonical keyword (keyword_metrics).
 *
 * "narrow" carries only what filtering, sorting and row identity need — the
 * columns held in the covering indexes from migration 005, so Postgres can
 * answer from the indexes alone. "full" adds the wide columns and is only ever
 * read for the rows of one page or one batch.
 */
function rowSource(mode: DedupMode, width: "narrow" | "full"): string {
  const metrics = `m.average_cpc_micros, m.avg_monthly_searches, m.competition, m.competition_index,
             m.low_top_micros, m.high_top_micros`;
  const wide =
    width === "full"
      ? `, m.monthly_volumes,
             m.prev_average_cpc_micros, m.prev_avg_monthly_searches,
             m.prev_low_top_micros, m.prev_high_top_micros`
      : "";

  if (mode === "intact") {
    return `
      select k.position                         as position,
             k.submitted_text                   as submitted,
             m.canonical_text                   as canonical,
             ${width === "full" ? "k.url" : "null::text"} as url,
             ${width === "full" ? "k.source_row" : "null::integer"} as source_row,
             ${metrics},
             coalesce(m.no_data, true)          as no_data${wide}
        from run_keywords k
        left join keyword_metrics m
          on m.run_id = k.run_id and m.canonical_text = k.canonical_text
       where k.run_id = $1`;
  }
  return `
      select null::integer                      as position,
             m.canonical_text                   as submitted,
             m.canonical_text                   as canonical,
             null::text                         as url,
             null::integer                      as source_row,
             ${metrics},
             m.no_data                          as no_data${wide}
        from keyword_metrics m
       where m.run_id = $1`;
}

/** Collects positional parameters so clauses can be built in any order. */
class Params {
  readonly values: unknown[];
  constructor(first: unknown[]) {
    this.values = [...first];
  }
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/**
 * WHERE clause over the row source's columns (aliased `r`). Mirrors the old
 * client-side `filtered` memo predicate for predicate.
 */
function whereClause(f: ResultsFilters, p: Params): string {
  const clauses: string[] = [];

  if (f.hideNoData) clauses.push("not r.no_data");

  // Old code: q = text.trim().toLowerCase(); keep rows whose lowercased
  // keyword includes q. strpos is a literal substring test — no LIKE
  // wildcards to escape.
  //
  // The search text is lowercased here, by the same toLowerCase() the old
  // code used; the keyword is lowercased by ICU (migration 005), which matches
  // toLowerCase() except for 8 letters added in Unicode 16–17.
  const q = f.text.trim().toLowerCase();
  if (q !== "") clauses.push(`strpos(lower(r.submitted collate keyword_order), ${p.add(q)}) > 0`);

  if (f.competition !== null) clauses.push(`r.competition = ${p.add(f.competition)}`);

  // Range filters target the primary metric. A row with no high top-of-page
  // bid is excluded whenever any of them is set; SQL comparisons with NULL
  // are not true, which is exactly that rule.
  if (f.minHighTopMicros !== null) clauses.push(`r.high_top_micros >= ${p.add(f.minHighTopMicros)}`);
  if (f.maxHighTopMicros !== null) clauses.push(`r.high_top_micros <= ${p.add(f.maxHighTopMicros)}`);
  if (f.bucket !== null) {
    clauses.push(`r.high_top_micros >= ${p.add(f.bucket.from)}`);
    clauses.push(`r.high_top_micros < ${p.add(f.bucket.to)}`);
  }

  if (f.minVolume !== null) clauses.push(`coalesce(r.avg_monthly_searches, 0) >= ${p.add(f.minVolume)}`);

  return clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`;
}

/**
 * Keyword text in alphabetical order. The explicit ICU collation (migration
 * 005) reproduces the browser's localeCompare; the database default may not.
 */
const ALPHA = "(r.submitted collate keyword_order)";

const NUMERIC_COLUMN: Partial<Record<SortState["key"], string>> = {
  lowTop: "r.low_top_micros",
  highTop: "r.high_top_micros",
  cpc: "r.average_cpc_micros",
  volume: "r.avg_monthly_searches",
  competition: "r.competition_index",
};

/**
 * ORDER BY reproducing the old comparator, which ran Array.prototype.sort
 * (stable) over rows already in the run's natural order:
 *   - numeric sorts sink no-data rows first, then put missing values last in
 *     BOTH directions;
 *   - ties fall back to the natural order — position for intact runs,
 *     alphabetical for deduped ones — which is also what makes paging
 *     deterministic: every row has exactly one place.
 */
function orderClause(mode: DedupMode, sort: SortState): string {
  const natural = mode === "intact" ? "r.position asc" : `${ALPHA} asc`;
  const dir = sort.dir === "asc" ? "asc" : "desc";

  const numeric = NUMERIC_COLUMN[sort.key];
  if (numeric) return `order by r.no_data asc, ${numeric} ${dir} nulls last, ${natural}`;

  if (sort.key === "keyword") return `order by ${ALPHA} ${dir}, ${natural}`;

  // "position": deduped rows have no position, so the old comparator returned
  // 0 for every pair and the natural order stood.
  if (mode === "intact") return `order by r.position ${dir}`;
  return `order by ${natural}`;
}

// --- mapping ----------------------------------------------------------------

type DbRow = {
  position: number | null;
  submitted: string;
  canonical: string | null;
  url: string | null;
  /** Index into the uploaded sheet's rows (intact runs from a sheet), else null. */
  source_row: number | null;
  average_cpc_micros: string | null;
  avg_monthly_searches: string | null;
  competition: string | null;
  competition_index: number | null;
  low_top_micros: string | null;
  high_top_micros: string | null;
  monthly_volumes: MonthlyVolume[] | null;
  no_data: boolean;
  prev_average_cpc_micros: string | null;
  prev_avg_monthly_searches: string | null;
  prev_low_top_micros: string | null;
  prev_high_top_micros: string | null;
};

/** pg returns bigint as string to avoid precision loss; these fit in a double. */
function big(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function toResultRow(r: DbRow, urls: string[]): ResultRow {
  return {
    submitted: r.submitted,
    canonical: r.canonical,
    position: r.position,
    averageCpcMicros: big(r.average_cpc_micros),
    avgMonthlySearches: big(r.avg_monthly_searches),
    competition: r.competition,
    competitionIndex: r.competition_index,
    lowTopMicros: big(r.low_top_micros),
    highTopMicros: big(r.high_top_micros),
    monthlyVolumes: r.monthly_volumes,
    noData: r.no_data,
    urls,
    prevHighTopMicros: big(r.prev_high_top_micros),
    prevLowTopMicros: big(r.prev_low_top_micros),
    prevAverageCpcMicros: big(r.prev_average_cpc_micros),
    prevAvgMonthlySearches: big(r.prev_avg_monthly_searches),
  };
}

/**
 * DEDUPED URL RULE (unchanged): every DISTINCT URL among the submitted rows
 * that collapsed into a canonical keyword, in order of first appearance.
 * Fetched only for the canonical keywords on the current page.
 */
async function dedupedUrls(runId: string, canonicals: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (canonicals.length === 0) return out;
  const rows = await query<{ canonical_text: string; urls: string[] }>(
    `select canonical_text, array_agg(url order by first_position) as urls
       from (select canonical_text, url, min(position) as first_position
               from run_keywords
              where run_id = $1 and canonical_text = any($2::text[]) and url is not null
              group by canonical_text, url) u
      group by canonical_text`,
    [runId, canonicals],
  );
  for (const r of rows) out.set(r.canonical_text, r.urls);
  return out;
}

async function attachUrls(runId: string, mode: DedupMode, rows: DbRow[]): Promise<ResultRow[]> {
  if (mode === "intact") return rows.map((r) => toResultRow(r, r.url === null ? [] : [r.url]));
  const urls = await dedupedUrls(runId, rows.map((r) => r.submitted));
  return rows.map((r) => toResultRow(r, urls.get(r.submitted) ?? []));
}

type RowId = { position: number | null; submitted: string };

/**
 * Full-width rows for the given identities, returned in the SAME order as
 * `ids`. Identity is the position in intact mode (unique per run) and the
 * canonical text in deduped mode (unique per run).
 */
async function fullRows(runId: string, mode: DedupMode, ids: RowId[]): Promise<DbRow[]> {
  if (ids.length === 0) return [];
  const rows =
    mode === "intact"
      ? await query<DbRow>(`select * from (${rowSource(mode, "full")}) r where r.position = any($2::int[])`, [
          runId,
          ids.map((i) => i.position),
        ])
      : await query<DbRow>(`select * from (${rowSource(mode, "full")}) r where r.submitted = any($2::text[])`, [
          runId,
          ids.map((i) => i.submitted),
        ]);
  const idOf = (r: RowId) => (mode === "intact" ? `p${r.position}` : `k${r.submitted}`);
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const ordered: DbRow[] = [];
  for (const id of ids) {
    const row = byId.get(idOf(id));
    // Every id came from the same run a moment ago; a miss means the run was
    // changed underneath us (refresh or delete), which must not pass silently.
    if (!row) throw new Error("Results changed while loading — reload the page.");
    ordered.push(row);
  }
  return ordered;
}

// --- public API ---------------------------------------------------------------

/** One page of the filtered, sorted table. */
export async function getResultsPage(
  runId: string,
  mode: DedupMode,
  q: ResultsQuery,
): Promise<ResultsPage> {
  const sort = q.sort ?? defaultSort(mode);
  const countParams = new Params([runId]);
  const countWhere = whereClause(q.filters, countParams);
  const [{ n }] = await query<{ n: string }>(
    `select count(*)::text as n from (${rowSource(mode, "narrow")}) r ${countWhere}`,
    countParams.values,
  );
  const total = Number(n);

  // A filter change can leave the user on a page that no longer exists; serve
  // the last real page instead of an empty table.
  const lastPage = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, lastPage);

  const p = new Params([runId]);
  const where = whereClause(q.filters, p);
  const limit = p.add(q.pageSize);
  const offset = p.add((page - 1) * q.pageSize);
  // Sort and page on the narrow columns, then widen just this page's rows.
  const ids = await query<RowId>(
    `select r.position, r.submitted
       from (${rowSource(mode, "narrow")}) r ${where} ${orderClause(mode, sort)}
      limit ${limit} offset ${offset}`,
    p.values,
  );
  const rows = await fullRows(runId, mode, ids);

  return { rows: await attachUrls(runId, mode, rows), total, page, pageSize: q.pageSize };
}

/**
 * Row keys (see row-key.ts) of EVERY row matching the filters, in display
 * order. Used for "select all matching" and shift-click ranges that span
 * pages — the two selection actions that need rows not on screen.
 */
export async function getMatchingKeys(
  runId: string,
  mode: DedupMode,
  filters: ResultsFilters,
  sort: SortState | null,
): Promise<string[]> {
  const p = new Params([runId]);
  const where = whereClause(filters, p);
  // Same formula as resultRowKey(): position when there is one, else text.
  const rows = await query<{ key: string }>(
    `select case when r.position is not null then 'p' || r.position else 'k' || r.submitted end as key
       from (${rowSource(mode, "narrow")}) r ${where} ${orderClause(mode, sort ?? defaultSort(mode))}`,
    p.values,
  );
  return rows.map((r) => r.key);
}

/** Rows per batch when walking a whole run (export, command line). */
export const ROW_BATCH_SIZE = 5_000;

export type RowWithSource = {
  row: ResultRow;
  /** Index into the uploaded sheet's rows, for the export; null if none. */
  sourceRow: number | null;
};

/**
 * Walks every row of a run in its natural order — position for intact runs,
 * alphabetical for deduped — in batches, so callers that need the whole run
 * (export, the CLI) never hold more than one batch of database rows plus their
 * own output.
 *
 * One ordered query read through a server-side cursor (DECLARE … FETCH), not a
 * query per batch: re-joining each batch cost ~100–150 ms apiece on a
 * 125,000-row run. Deduped URL lists are aggregated in the same query.
 *
 * The cursor holds a read-only transaction and a pool connection until the
 * walk ends. Stopping early (a cancelled download) closes both, because the
 * generator's `finally` runs when the consumer calls return().
 *
 * `selection`, when given, restricts the walk to those row keys (row-key.ts).
 */
export async function* iterateResultRows(
  runId: string,
  mode: DedupMode,
  selection?: string[],
  batchSize = ROW_BATCH_SIZE,
): AsyncGenerator<RowWithSource[]> {
  const p = new Params([runId]);
  const clauses: string[] = [];
  if (selection) {
    const positions: number[] = [];
    const texts: string[] = [];
    for (const key of selection) {
      if (/^p\d+$/.test(key)) positions.push(Number(key.slice(1)));
      else if (key.startsWith("k")) texts.push(key.slice(1));
    }
    // A key names a row by position (intact) or text (deduped); a key of the
    // other kind cannot match anything in this mode.
    clauses.push(
      mode === "intact"
        ? `r.position = any(${p.add(positions)}::int[])`
        : `r.submitted = any(${p.add(texts)}::text[])`,
    );
  }

  // DEDUPED URL RULE, as in dedupedUrls(), per row through the
  // (run_id, canonical_text) index. A LATERAL lookup rather than a join to a
  // grouped subquery: Postgres estimates such a subquery at 200 rows whatever
  // its real size, and under a cursor that misestimate produced a nested loop
  // that rescanned ~120,000 rows per keyword.
  const urlsJoin =
    mode === "deduped"
      ? `left join lateral (
           select array_agg(x.url order by x.first_position) as urls
             from (select k2.url, min(k2.position) as first_position
                     from run_keywords k2
                    where k2.run_id = $1 and k2.canonical_text = r.submitted and k2.url is not null
                    group by k2.url) x
         ) u on true`
      : "";
  const sql = `
    select r.*${mode === "deduped" ? ", u.urls as deduped_urls" : ""}
      from (${rowSource(mode, "full")}) r
      ${urlsJoin}
      ${clauses.length > 0 ? `where ${clauses.join(" and ")}` : ""}
     order by ${mode === "intact" ? "r.position asc" : `${ALPHA} asc`}`;

  const client = await getPool().connect();
  let inTransaction = false;
  let broken = false;
  try {
    await client.query("begin read only");
    inTransaction = true;
    // This cursor is always read to the end, so plan for total time, not for
    // the first rows (the default, 0.1, favours fast-start nested loops).
    await client.query("set local cursor_tuple_fraction = 1");
    await client.query(`declare results_walk no scroll cursor for ${sql}`, p.values);
    for (;;) {
      const { rows } = await client.query<DbRow & { deduped_urls?: string[] | null }>(
        `fetch forward ${Math.max(1, Math.floor(batchSize))} from results_walk`,
      );
      if (rows.length === 0) break;
      yield rows.map((r) => ({
        row: toResultRow(r, mode === "intact" ? (r.url === null ? [] : [r.url]) : (r.deduped_urls ?? [])),
        sourceRow: r.source_row,
      }));
      if (rows.length < batchSize) break;
    }
    await client.query("commit");
    inTransaction = false;
  } finally {
    // Reached on completion, on error, and when the consumer stops early
    // (return()), in which case the transaction and cursor are still open.
    if (inTransaction) {
      await client.query("rollback").catch(() => {
        broken = true;
      });
    }
    // A connection whose rollback failed is in an unknown state: destroy it
    // instead of handing it back to the pool.
    client.release(broken);
  }
}

/**
 * Everything the page header needs about the WHOLE run in this mode: counts,
 * heat bands and histogram. Computed over the same rows the old code used —
 * every table row, unfiltered, including duplicate submitted rows in intact
 * mode — so the bands and bars are unchanged.
 */
export async function getResultsOverview(runId: string, mode: DedupMode): Promise<ResultsOverview> {
  const [stats] = await query<{
    row_count: string;
    no_data_rows: string;
    n: string;
    distinct_n: string;
    min: string | null;
    max: string | null;
    p33: number | null;
    p67: number | null;
  }>(
    `select count(*)::text                                    as row_count,
            count(*) filter (where r.no_data)::text           as no_data_rows,
            count(r.high_top_micros)::text                    as n,
            count(distinct r.high_top_micros)::text           as distinct_n,
            min(r.high_top_micros)::text                      as min,
            max(r.high_top_micros)::text                      as max,
            percentile_cont($2::float8) within group (order by r.high_top_micros) as p33,
            percentile_cont($3::float8) within group (order by r.high_top_micros) as p67
       from (${rowSource(mode, "narrow")}) r`,
    // Passed as the same doubles heat.ts's quantile() used.
    [runId, 1 / 3, 2 / 3],
  );

  const n = Number(stats.n);
  const min = stats.min === null ? null : Number(stats.min);
  const max = stats.max === null ? null : Number(stats.max);

  const bands =
    n === 0 || min === null || max === null
      ? null
      : tertilesFromStats({
          distinct: Number(stats.distinct_n),
          min,
          max,
          p33: stats.p33 as number,
          p67: stats.p67 as number,
        });

  let histogram: Bucket[] = [];
  if (n > 0 && min !== null && max !== null) {
    const layout = histogramLayout(min, max);
    if (layout.kind === "single") {
      histogram = [{ from: min, to: min + 1, count: n }];
    } else {
      // Same arithmetic as heat.ts histogram(), in float8 (a JS number):
      // i = min(last, floor((v - start) / width)).
      const counts = await query<{ i: number; c: string }>(
        `select least($2::int - 1, floor((r.high_top_micros::float8 - $3::float8) / $4::float8))::int as i,
                count(*)::text as c
           from (${rowSource(mode, "narrow")}) r
          where r.high_top_micros is not null
          group by 1`,
        [runId, layout.bucketCount, layout.start, layout.width],
      );
      histogram = Array.from({ length: layout.bucketCount }, (_, i) => ({
        from: layout.start + i * layout.width,
        to: layout.start + (i + 1) * layout.width,
        count: 0,
      }));
      for (const c of counts) histogram[c.i].count = Number(c.c);
    }
  }

  return { rowCount: Number(stats.row_count), noDataRows: Number(stats.no_data_rows), bands, histogram };
}
