import "server-only";
import { query } from "./db";
import { withDefaults } from "./run-settings";
import { isRunId } from "./ids";
import { iterateResultRows } from "./results-table";
import type { ResultRow, RunSettings, RunSummary } from "./types";

export type { ResultRow, RunSummary };

/**
 * Reading a completed run back out, in either dedup mode (PLAN.md §1):
 *   - "intact"  — one row per submitted keyword, original order, metrics merged
 *   - "deduped" — one row per canonical keyword
 *
 * The results PAGE no longer uses getResults — it reads one page at a time
 * through results-table.ts. getResults remains for the command-line script,
 * which genuinely wants every row.
 */

export async function getResults(
  runId: string,
  mode?: RunSettings["dedupMode"],
): Promise<ResultRow[]> {
  if (!isRunId(runId)) throw new Error("Run not found");
  const runRows = await query<{ settings: RunSettings }>("select settings from runs where id = $1", [runId]);
  if (runRows.length === 0) throw new Error(`Run ${runId} not found`);
  const dedupMode = mode ?? withDefaults(runRows[0].settings).dedupMode;

  const out: ResultRow[] = [];
  for await (const batch of iterateResultRows(runId, dedupMode)) {
    for (const { row } of batch) out.push(row);
  }
  return out;
}

/**
 * Summary stats over the canonical (deduped) rows — weighting by volume across
 * duplicated submitted rows would double-count.
 *
 * Computed in Postgres. It used to load every metrics row into Node and loop;
 * the formulas are unchanged:
 *   - weighted: Σ(v·volume)/Σ(volume) over rows with data and a value, falling
 *     back to the plain mean when every such row has zero volume;
 *   - median: middle value, or the mean of the two middle values, rounded;
 *   - totalMonthlyVolume: sum over ALL rows, no-data included (null = 0).
 *
 * Sums are exact `numeric` here, where the old JavaScript loop accumulated in
 * doubles; on very large runs that can differ from the old figure in the last
 * micro, in the direction of being correct.
 */
export async function getRunSummary(runId: string): Promise<RunSummary> {
  if (!isRunId(runId)) throw new Error("Run not found");

  const weighted = (col: string) => `
    case
      when sum(m.avg_monthly_searches::numeric) filter (where not m.no_data and m.${col} is not null) > 0
        then (sum(m.${col}::numeric * coalesce(m.avg_monthly_searches, 0))
                filter (where not m.no_data and m.${col} is not null)
              / sum(m.avg_monthly_searches::numeric)
                filter (where not m.no_data and m.${col} is not null))::text
      else (avg(m.${col}::numeric) filter (where not m.no_data and m.${col} is not null))::text
    end`;

  // percentile_cont(0.5) is the old median: the middle value, or the mean of
  // the two middle values (computed as a + 0.5·(b − a), exact in float8 for
  // micros-sized integers), rounded in JS exactly as before.
  const median = (col: string) =>
    `(percentile_cont(0.5) within group (order by m.${col}::float8)
        filter (where not m.no_data and m.${col} is not null))`;

  const [r] = await query<{
    total: string;
    with_data: string;
    volume_total: string | null;
    w_high: string | null;
    w_low: string | null;
    w_cpc: string | null;
    med_high: number | null;
    med_cpc: number | null;
  }>(
    `select count(*)::text                                                         as total,
            count(*) filter (where not m.no_data and m.high_top_micros is not null)::text as with_data,
            sum(m.avg_monthly_searches)::text                                       as volume_total,
            ${weighted("high_top_micros")}                                          as w_high,
            ${weighted("low_top_micros")}                                           as w_low,
            ${weighted("average_cpc_micros")}                                       as w_cpc,
            ${median("high_top_micros")}                                            as med_high,
            ${median("average_cpc_micros")}                                         as med_cpc
       from keyword_metrics m
      where m.run_id = $1`,
    [runId],
  );

  const total = Number(r.total);
  const withData = Number(r.with_data);
  const round = (v: string | number | null) => (v === null ? null : Math.round(Number(v)));

  return {
    total,
    withData,
    noData: total - withData,
    weightedAvgHighTopMicros: round(r.w_high),
    medianHighTopMicros: round(r.med_high),
    weightedAvgLowTopMicros: round(r.w_low),
    weightedAvgCpcMicros: round(r.w_cpc),
    medianCpcMicros: round(r.med_cpc),
    totalMonthlyVolume: r.volume_total === null ? 0 : Number(r.volume_total),
  };
}

export { formatMicros } from "./format";
