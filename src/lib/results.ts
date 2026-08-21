import "server-only";
import { query } from "./db";
import { withDefaults } from "./run-settings";
import type { MonthlyVolume, ResultRow, RunSettings, RunSummary } from "./types";

export type { ResultRow, RunSummary };

/**
 * Reading a completed run back out, in either dedup mode (PLAN.md §1):
 *   - "intact"  — one row per submitted keyword, original order, metrics merged
 *   - "deduped" — one row per canonical keyword
 */

type MetricsDbRow = {
  canonical_text: string;
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

function toRow(submitted: string, position: number | null, m: MetricsDbRow | undefined): ResultRow {
  if (!m) {
    return {
      submitted,
      canonical: null,
      position,
      averageCpcMicros: null,
      avgMonthlySearches: null,
      competition: null,
      competitionIndex: null,
      lowTopMicros: null,
      highTopMicros: null,
      monthlyVolumes: null,
      noData: true,
      prevHighTopMicros: null,
      prevLowTopMicros: null,
      prevAverageCpcMicros: null,
      prevAvgMonthlySearches: null,
    };
  }
  return {
    submitted,
    canonical: m.canonical_text,
    position,
    averageCpcMicros: big(m.average_cpc_micros),
    avgMonthlySearches: big(m.avg_monthly_searches),
    competition: m.competition,
    competitionIndex: m.competition_index,
    lowTopMicros: big(m.low_top_micros),
    highTopMicros: big(m.high_top_micros),
    monthlyVolumes: m.monthly_volumes,
    noData: m.no_data,
    prevHighTopMicros: big(m.prev_high_top_micros),
    prevLowTopMicros: big(m.prev_low_top_micros),
    prevAverageCpcMicros: big(m.prev_average_cpc_micros),
    prevAvgMonthlySearches: big(m.prev_avg_monthly_searches),
  };
}

export async function getResults(
  runId: string,
  mode?: RunSettings["dedupMode"],
): Promise<ResultRow[]> {
  const runRows = await query<{ settings: RunSettings }>("select settings from runs where id = $1", [runId]);
  if (runRows.length === 0) throw new Error(`Run ${runId} not found`);
  const dedupMode = mode ?? withDefaults(runRows[0].settings).dedupMode;

  const metrics = await query<MetricsDbRow>(
    `select canonical_text, average_cpc_micros, avg_monthly_searches, competition,
            competition_index, low_top_micros, high_top_micros, monthly_volumes, no_data,
            prev_average_cpc_micros, prev_avg_monthly_searches,
            prev_low_top_micros, prev_high_top_micros
       from keyword_metrics where run_id = $1`,
    [runId],
  );
  const byCanonical = new Map(metrics.map((m) => [m.canonical_text, m]));

  if (dedupMode === "deduped") {
    return metrics
      .map((m) => toRow(m.canonical_text, null, m))
      .sort((a, b) => a.submitted.localeCompare(b.submitted));
  }

  // Intact: replay the user's rows in their original order.
  const submitted = await query<{ submitted_text: string; canonical_text: string | null; position: number }>(
    "select submitted_text, canonical_text, position from run_keywords where run_id = $1 order by position asc",
    [runId],
  );

  return submitted.map((s) =>
    toRow(s.submitted_text, s.position, s.canonical_text ? byCanonical.get(s.canonical_text) : undefined),
  );
}

/**
 * Summary stats over the canonical (deduped) rows — weighting by volume across
 * duplicated submitted rows would double-count.
 */
export async function getRunSummary(runId: string): Promise<RunSummary> {
  const rows = await query<MetricsDbRow>(
    `select canonical_text, average_cpc_micros, avg_monthly_searches, competition,
            competition_index, low_top_micros, high_top_micros, monthly_volumes, no_data,
            prev_average_cpc_micros, prev_avg_monthly_searches,
            prev_low_top_micros, prev_high_top_micros
       from keyword_metrics where run_id = $1`,
    [runId],
  );

  // "Has data" is judged on the primary metric — the top-of-page band.
  const withData = rows.filter((r) => !r.no_data && r.high_top_micros !== null);

  let volumeTotal = 0;
  for (const r of rows) volumeTotal += big(r.avg_monthly_searches) ?? 0;

  /**
   * Volume-weighted mean over rows that actually carry the metric. Falls back
   * to the unweighted mean when every keyword has zero volume, rather than
   * dividing by zero and reporting nothing at all.
   */
  function weighted(pick: (r: MetricsDbRow) => number | null): number | null {
    let numerator = 0;
    let weight = 0;
    const values: number[] = [];
    for (const r of rows) {
      if (r.no_data) continue;
      const v = pick(r);
      if (v === null) continue;
      const volume = big(r.avg_monthly_searches) ?? 0;
      values.push(v);
      numerator += v * volume;
      weight += volume;
    }
    if (weight > 0) return Math.round(numerator / weight);
    if (values.length > 0) return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    return null;
  }

  function median(pick: (r: MetricsDbRow) => number | null): number | null {
    const values = rows
      .filter((r) => !r.no_data)
      .map(pick)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    return values.length % 2 === 1
      ? values[(values.length - 1) / 2]
      : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2);
  }

  return {
    total: rows.length,
    withData: withData.length,
    noData: rows.length - withData.length,
    weightedAvgHighTopMicros: weighted((r) => big(r.high_top_micros)),
    medianHighTopMicros: median((r) => big(r.high_top_micros)),
    weightedAvgLowTopMicros: weighted((r) => big(r.low_top_micros)),
    weightedAvgCpcMicros: weighted((r) => big(r.average_cpc_micros)),
    medianCpcMicros: median((r) => big(r.average_cpc_micros)),
    totalMonthlyVolume: volumeTotal,
  };
}

export { formatMicros } from "./format";
