import "server-only";
import { query } from "./db";
import { getRunSummary } from "./results";
import { isRunId } from "./ids";
import type { RunSummary } from "./types";

/**
 * Run comparison — PLAN.md §6 screen 3, "pick 2 runs → delta table".
 *
 * Joins on `canonical_text`, which is Google's own collapsed form, so two runs
 * that submitted "cars" and "car" still line up. Comparing submitted text would
 * miss that.
 *
 * The join, ordering and paging happen in Postgres and the page receives one
 * page of rows. Previously every keyword of both runs was loaded into Node and
 * rendered at once: comparing two 125,000-keyword runs took the server to
 * 5.6 GB until the operating system killed it.
 *
 * Row values and ordering are unchanged — checked against the previous
 * implementation on two 125,000-keyword runs:
 *   - a side's values are null when the keyword is absent from that run or is
 *     a no-data row there;
 *   - deltas are b − a, null when either side is null;
 *   - keywords in both runs come first, biggest absolute change first, then
 *     keywords only in A, then only in B.
 * The one addition is a final tie-break by keyword (alphabetical, the same
 * ICU order as the results table). Ties used to fall in whatever order the
 * database happened to return rows, which paging cannot work with.
 */

export type CompareRow = {
  keyword: string;
  aHighTop: number | null;
  bHighTop: number | null;
  aVolume: number | null;
  bVolume: number | null;
  aCpc: number | null;
  bCpc: number | null;
  /** b − a, in micros. Null when either side is missing the metric. */
  highTopDelta: number | null;
  volumeDelta: number | null;
  /** Which runs contain this keyword at all. */
  presence: "both" | "only-a" | "only-b";
};

export type CompareResult = {
  a: { id: string; name: string; createdAt: string; summary: RunSummary };
  b: { id: string; name: string; createdAt: string; summary: RunSummary };
  /** One page of rows, in comparison order. */
  rows: CompareRow[];
  inBoth: number;
  onlyA: number;
  onlyB: number;
  /** All rows across pages (inBoth + onlyA + onlyB). */
  total: number;
  /** The page actually returned — clamped to the last page if past it. */
  page: number;
  pageSize: number;
};

export const COMPARE_PAGE_SIZE = 100;

export { isRunId } from "./ids";

/**
 * Every keyword of either run, one row each. `$1` = run A, `$2` = run B.
 * A side's values are nulled for a no-data row, exactly as before.
 */
const JOINED = `
  select coalesce(a.canonical_text, b.canonical_text)                        as keyword,
         case when not a.no_data then a.high_top_micros end                 as a_high,
         case when not b.no_data then b.high_top_micros end                 as b_high,
         case when not a.no_data then a.avg_monthly_searches end            as a_volume,
         case when not b.no_data then b.avg_monthly_searches end            as b_volume,
         case when not a.no_data then a.average_cpc_micros end              as a_cpc,
         case when not b.no_data then b.average_cpc_micros end              as b_cpc,
         case when a.canonical_text is not null and b.canonical_text is not null then 'both'
              when a.canonical_text is not null then 'only-a'
              else 'only-b' end                                              as presence
    from (select canonical_text, high_top_micros, avg_monthly_searches, average_cpc_micros, no_data
            from keyword_metrics where run_id = $1) a
    full outer join
         (select canonical_text, high_top_micros, avg_monthly_searches, average_cpc_micros, no_data
            from keyword_metrics where run_id = $2) b
      on a.canonical_text = b.canonical_text`;

type DbRow = {
  keyword: string;
  a_high: string | null;
  b_high: string | null;
  a_volume: string | null;
  b_volume: string | null;
  a_cpc: string | null;
  b_cpc: string | null;
  presence: CompareRow["presence"];
};

/** pg returns bigint as string to avoid precision loss; these fit in a double. */
const big = (v: string | null) => (v === null ? null : Number(v));

function toRow(r: DbRow): CompareRow {
  const aHighTop = big(r.a_high);
  const bHighTop = big(r.b_high);
  const aVolume = big(r.a_volume);
  const bVolume = big(r.b_volume);
  return {
    keyword: r.keyword,
    aHighTop,
    bHighTop,
    aVolume,
    bVolume,
    aCpc: big(r.a_cpc),
    bCpc: big(r.b_cpc),
    // Computed in JS from the same numbers, as before, so the arithmetic is
    // identical.
    highTopDelta: aHighTop !== null && bHighTop !== null ? bHighTop - aHighTop : null,
    volumeDelta: aVolume !== null && bVolume !== null ? bVolume - aVolume : null,
    presence: r.presence,
  };
}

async function loadMeta(runId: string) {
  const rows = await query<{ id: string; name: string | null; created_at: Date }>(
    "select id, name, created_at from runs where id = $1",
    [runId],
  );
  return rows[0] ?? null;
}

export async function compareRuns(
  aId: string,
  bId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<CompareResult | null> {
  if (!isRunId(aId) || !isRunId(bId)) return null;

  const [aMeta, bMeta] = await Promise.all([loadMeta(aId), loadMeta(bId)]);
  if (!aMeta || !bMeta) return null;

  const pageSize = opts.pageSize ?? COMPARE_PAGE_SIZE;

  const [[counts], aSummary, bSummary] = await Promise.all([
    query<{ in_both: string; only_a: string; only_b: string }>(
      `select count(*) filter (where presence = 'both')::text   as in_both,
              count(*) filter (where presence = 'only-a')::text as only_a,
              count(*) filter (where presence = 'only-b')::text as only_b
         from (${JOINED}) j`,
      [aId, bId],
    ),
    getRunSummary(aId),
    getRunSummary(bId),
  ]);
  const inBoth = Number(counts.in_both);
  const onlyA = Number(counts.only_a);
  const onlyB = Number(counts.only_b);
  const total = inBoth + onlyA + onlyB;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), lastPage);

  // Biggest movers first; keywords present in only one run sink to the bottom
  // (A-only before B-only), since there is no movement to rank them by.
  const rows = await query<DbRow>(
    `select * from (${JOINED}) j
      order by case j.presence when 'both' then 0 when 'only-a' then 1 else 2 end,
               abs(coalesce(j.b_high - j.a_high, 0)) desc,
               (j.keyword collate keyword_order)
      limit $3 offset $4`,
    [aId, bId, pageSize, (page - 1) * pageSize],
  );

  const label = (m: { id: string; name: string | null }) => m.name ?? `Run ${m.id.slice(0, 8)}`;

  return {
    a: { id: aMeta.id, name: label(aMeta), createdAt: aMeta.created_at.toISOString(), summary: aSummary },
    b: { id: bMeta.id, name: label(bMeta), createdAt: bMeta.created_at.toISOString(), summary: bSummary },
    rows: rows.map(toRow),
    inBoth,
    onlyA,
    onlyB,
    total,
    page,
    pageSize,
  };
}
