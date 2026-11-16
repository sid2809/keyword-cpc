import "server-only";
import { getPool, query } from "./db";
import { isRunId } from "./ids";
import type { ProjectFilters, ProjectQuery, ProjectSortKey } from "./project-params";
import type { MonthlyVolume } from "./types";

/**
 * The project page's table: paged, filtered and sorted in SQL, like the
 * results table, so a project with 100,000+ keywords stays fast.
 *
 * Latest-only mode has one row per entry (its newest fetch). History mode has
 * one row per fetch; filters then apply to each fetch's own numbers.
 */

export type ProjectRow = {
  /** project_keywords.id */
  entryId: string;
  /** project_keyword_fetches.id */
  fetchId: string;
  keyword: string;
  geo: string[];
  language: string | null;
  network: string;
  addedAt: string;
  fetchedAt: string;
  /** False only in history mode, for a fetch that a newer one has replaced. */
  latest: boolean;
  noData: boolean;
  avgMonthlySearches: number | null;
  highTopMicros: number | null;
  lowTopMicros: number | null;
  averageCpcMicros: number | null;
  competition: string | null;
  competitionIndex: number | null;
  monthlyVolumes: MonthlyVolume[] | null;
  /** High top-of-page bid of the fetch before this one, if any. */
  prevHighTopMicros: number | null;
  /** How many fetches this entry has. */
  fetches: number;
};

export type ProjectPage = { rows: ProjectRow[]; total: number; page: number; pageSize: number };

export type ProjectFacets = { geos: string[]; hasWorldwide: boolean; languages: (string | null)[]; networks: string[] };

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

/** Entries joined to the fetches in view: the newest per entry, or all. */
function source(latestOnly: boolean): string {
  return latestOnly
    ? `project_keywords pk
       join lateral (
         select * from project_keyword_fetches x
          where x.project_keyword_id = pk.id
          order by x.fetched_at desc, x.id desc limit 1
       ) f on true`
    : `project_keywords pk
       join project_keyword_fetches f on f.project_keyword_id = pk.id`;
}

function where(filters: ProjectFilters, p: Params): string {
  const c = ["pk.project_id = $1"];
  if (filters.text.trim() !== "") {
    const escaped = filters.text.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
    c.push(`pk.keyword_key like ${p.add(`%${escaped}%`)}`);
  }
  if (filters.geo === "worldwide") c.push("jsonb_array_length(pk.settings->'geoTargetConstants') = 0");
  else if (filters.geo !== null) c.push(`pk.settings->'geoTargetConstants' @> to_jsonb(${p.add(filters.geo)}::text)`);
  if (filters.language === "any") c.push("pk.settings->>'language' is null");
  else if (filters.language !== null) c.push(`pk.settings->>'language' = ${p.add(filters.language)}`);
  if (filters.network !== null) c.push(`pk.settings->>'network' = ${p.add(filters.network)}`);
  if (filters.minSearches !== null) c.push(`f.avg_monthly_searches >= ${p.add(filters.minSearches)}`);
  if (filters.minHighTopMicros !== null) c.push(`f.high_top_micros >= ${p.add(filters.minHighTopMicros)}`);
  if (filters.maxHighTopMicros !== null) c.push(`f.high_top_micros <= ${p.add(filters.maxHighTopMicros)}`);
  if (filters.hideNoData) c.push("not f.no_data");
  return c.join(" and ");
}

const SORT_SQL: Record<ProjectSortKey, string> = {
  added: "pk.id",
  keyword: "(pk.keyword_key collate keyword_order)",
  searches: "f.avg_monthly_searches",
  highTop: "f.high_top_micros",
  lowTop: "f.low_top_micros",
  fetched: "f.fetched_at",
};

function orderBy(sort: ProjectQuery["sort"]): string {
  const dir = sort.dir === "desc" ? "desc" : "asc";
  // Rows without a value always sort last; ties fall back to a stable order,
  // keeping an entry's fetches together, newest first.
  return `${SORT_SQL[sort.key]} ${dir} nulls last, pk.id asc, f.fetched_at desc, f.id desc`;
}

type Raw = {
  entry_id: string;
  fetch_id: string;
  keyword: string;
  settings: { geoTargetConstants?: string[]; language?: string | null; network?: string };
  added_at: Date;
  fetched_at: Date;
  latest: boolean;
  no_data: boolean;
  avg_monthly_searches: string | null;
  high_top_micros: string | null;
  low_top_micros: string | null;
  average_cpc_micros: string | null;
  competition: string | null;
  competition_index: number | null;
  monthly_volumes: MonthlyVolume[] | null;
  prev_high_top_micros: string | null;
  fetches: number;
};

const num = (v: string | null) => (v === null ? null : Number(v));

function toRow(r: Raw): ProjectRow {
  return {
    entryId: String(r.entry_id),
    fetchId: String(r.fetch_id),
    keyword: r.keyword,
    geo: r.settings.geoTargetConstants ?? [],
    language: r.settings.language ?? null,
    network: r.settings.network ?? "GOOGLE_SEARCH",
    addedAt: r.added_at.toISOString(),
    fetchedAt: r.fetched_at.toISOString(),
    latest: r.latest,
    noData: r.no_data,
    avgMonthlySearches: num(r.avg_monthly_searches),
    highTopMicros: num(r.high_top_micros),
    lowTopMicros: num(r.low_top_micros),
    averageCpcMicros: num(r.average_cpc_micros),
    competition: r.competition,
    competitionIndex: r.competition_index,
    monthlyVolumes: r.monthly_volumes,
    prevHighTopMicros: num(r.prev_high_top_micros),
    fetches: r.fetches,
  };
}

/**
 * The page's rows are picked first (narrow), then widened: the per-row extras
 * (previous bid, fetch count, "is this the latest") run only for that page.
 */
function pageSql(q: Pick<ProjectQuery, "filters" | "sort" | "latestOnly">, p: Params, limitOffset: string): string {
  return `
    select t.*,
           (select x.high_top_micros from project_keyword_fetches x
             where x.project_keyword_id = t.entry_id
               and (x.fetched_at, x.id) < (t.fetched_at, t.fetch_id)
             order by x.fetched_at desc, x.id desc limit 1) as prev_high_top_micros,
           (select count(*)::int from project_keyword_fetches x where x.project_keyword_id = t.entry_id) as fetches,
           not exists (select 1 from project_keyword_fetches x
                        where x.project_keyword_id = t.entry_id
                          and (x.fetched_at, x.id) > (t.fetched_at, t.fetch_id)) as latest
      from (
        select pk.id as entry_id, f.id as fetch_id, pk.keyword, pk.settings, pk.added_at, f.fetched_at,
               f.no_data, f.avg_monthly_searches, f.high_top_micros, f.low_top_micros, f.average_cpc_micros,
               f.competition, f.competition_index, f.monthly_volumes,
               row_number() over (order by ${orderBy(q.sort)}) as ord
          from ${source(q.latestOnly)}
         where ${where(q.filters, p)}
         order by ${orderBy(q.sort)}
         ${limitOffset}
      ) t
     order by t.ord`;
}

export async function getProjectPage(projectId: string, q: ProjectQuery): Promise<ProjectPage> {
  if (!isRunId(projectId)) return { rows: [], total: 0, page: 1, pageSize: q.pageSize };

  const cp = new Params([projectId]);
  const counted = await query<{ n: string }>(
    `select count(*) as n from ${source(q.latestOnly)} where ${where(q.filters, cp)}`,
    cp.values,
  );
  const total = Number(counted[0]?.n ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, lastPage);

  const p = new Params([projectId]);
  const sql = pageSql(q, p, `limit ${p.add(q.pageSize)} offset ${p.add((page - 1) * q.pageSize)}`);
  const rows = await query<Raw>(sql, p.values);
  return { rows: rows.map(toRow), total, page, pageSize: q.pageSize };
}

/** Every row matching the query, in order, in batches (for export). */
export async function* iterateProjectRows(
  projectId: string,
  q: Pick<ProjectQuery, "filters" | "sort" | "latestOnly">,
  batchSize = 2000,
): AsyncGenerator<ProjectRow[]> {
  if (!isRunId(projectId)) return;
  const p = new Params([projectId]);
  const sql = pageSql(q, p, "");
  const client = await getPool().connect();
  try {
    await client.query("begin read only");
    await client.query("set local cursor_tuple_fraction = 1");
    await client.query({ text: `declare project_rows no scroll cursor for ${sql}`, values: p.values });
    for (;;) {
      const res = await client.query<Raw>(`fetch ${batchSize} from project_rows`);
      if (res.rows.length === 0) break;
      yield res.rows.map(toRow);
      if (res.rows.length < batchSize) break;
    }
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** The distinct settings present in a project, for the filter dropdowns. */
export async function getProjectFacets(projectId: string): Promise<ProjectFacets> {
  if (!isRunId(projectId)) return { geos: [], hasWorldwide: false, languages: [], networks: [] };
  const rows = await query<{ settings: Raw["settings"] }>(
    "select distinct settings from project_keywords where project_id = $1",
    [projectId],
  );
  const geos = new Set<string>();
  const languages = new Set<string | null>();
  const networks = new Set<string>();
  let hasWorldwide = false;
  for (const { settings } of rows) {
    const g = settings.geoTargetConstants ?? [];
    if (g.length === 0) hasWorldwide = true;
    for (const id of g) geos.add(id);
    languages.add(settings.language ?? null);
    if (settings.network) networks.add(settings.network);
  }
  return { geos: [...geos], hasWorldwide, languages: [...languages], networks: [...networks] };
}

/** Removes entries (and their history) from a project. Returns how many. */
export async function removeProjectEntries(projectId: string, entryIds: string[]): Promise<number> {
  if (!isRunId(projectId)) return 0;
  const ids = entryIds.filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return 0;
  const rows = await query<{ id: string }>(
    "delete from project_keywords where project_id = $1 and id = any($2::bigint[]) returning id",
    [projectId, ids],
  );
  if (rows.length > 0) await query("update projects set updated_at = now() where id = $1", [projectId]);
  return rows.length;
}
