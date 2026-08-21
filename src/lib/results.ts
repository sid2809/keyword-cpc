import "server-only";
import { query } from "./db";
import type { MonthlyVolume } from "./google-ads";
import { withDefaults, type RunSettings } from "./run-settings";

/**
 * Reading a completed run back out, in either dedup mode (PLAN.md §1):
 *   - "intact"  — one row per submitted keyword, original order, metrics merged
 *   - "deduped" — one row per canonical keyword
 */

export type ResultRow = {
  /** What the user typed. Equals `canonical` in deduped mode. */
  submitted: string;
  canonical: string | null;
  position: number | null;
  averageCpcMicros: number | null;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopMicros: number | null;
  highTopMicros: number | null;
  monthlyVolumes: MonthlyVolume[] | null;
  noData: boolean;
};

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
            competition_index, low_top_micros, high_top_micros, monthly_volumes, no_data
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

export type RunSummary = {
  total: number;
  withData: number;
  noData: number;
  /** Volume-weighted average CPC in micros — the headline number (PLAN.md §1). */
  weightedAvgCpcMicros: number | null;
  medianCpcMicros: number | null;
  totalMonthlyVolume: number;
};

/**
 * Summary stats over the canonical (deduped) rows — weighting by volume across
 * duplicated submitted rows would double-count.
 */
export async function getRunSummary(runId: string): Promise<RunSummary> {
  const rows = await query<MetricsDbRow>(
    `select canonical_text, average_cpc_micros, avg_monthly_searches, competition,
            competition_index, low_top_micros, high_top_micros, monthly_volumes, no_data
       from keyword_metrics where run_id = $1`,
    [runId],
  );

  const withData = rows.filter((r) => !r.no_data && r.average_cpc_micros !== null);

  let weightedNumerator = 0;
  let weightTotal = 0;
  let volumeTotal = 0;
  const cpcs: number[] = [];

  for (const r of rows) {
    const volume = big(r.avg_monthly_searches) ?? 0;
    volumeTotal += volume;
    const cpc = big(r.average_cpc_micros);
    if (cpc === null || r.no_data) continue;
    cpcs.push(cpc);
    weightedNumerator += cpc * volume;
    weightTotal += volume;
  }

  cpcs.sort((a, b) => a - b);
  const median =
    cpcs.length === 0
      ? null
      : cpcs.length % 2 === 1
        ? cpcs[(cpcs.length - 1) / 2]
        : Math.round((cpcs[cpcs.length / 2 - 1] + cpcs[cpcs.length / 2]) / 2);

  return {
    total: rows.length,
    withData: withData.length,
    noData: rows.length - withData.length,
    // Falls back to the unweighted mean when every keyword has zero volume,
    // rather than dividing by zero and reporting nothing.
    weightedAvgCpcMicros:
      weightTotal > 0
        ? Math.round(weightedNumerator / weightTotal)
        : cpcs.length > 0
          ? Math.round(cpcs.reduce((a, b) => a + b, 0) / cpcs.length)
          : null,
    medianCpcMicros: median,
    totalMonthlyVolume: volumeTotal,
  };
}

/** ₹1,234.56 — micros ÷ 1,000,000, Indian digit grouping (PLAN.md §5). */
export function formatMicros(micros: number | null): string {
  if (micros === null) return "—";
  return `₹${(micros / 1_000_000).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
