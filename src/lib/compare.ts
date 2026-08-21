import "server-only";
import { query } from "./db";
import { getRunSummary } from "./results";
import type { RunSummary } from "./types";

/**
 * Run comparison — PLAN.md §6 screen 3, "pick 2 runs → delta table".
 *
 * Joins on `canonical_text`, which is Google's own collapsed form, so two runs
 * that submitted "cars" and "car" still line up. Comparing submitted text would
 * miss that.
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
  rows: CompareRow[];
  inBoth: number;
  onlyA: number;
  onlyB: number;
};

type MetricRow = {
  canonical_text: string;
  high_top_micros: string | null;
  avg_monthly_searches: string | null;
  average_cpc_micros: string | null;
  no_data: boolean;
};

const big = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * Postgres raises "invalid input syntax for type uuid" on a malformed id, which
 * surfaces as a 500 rather than the page's own empty state. Guard before
 * querying so a hand-edited URL gets the friendly message instead.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isRunId(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function loadRun(runId: string) {
  const meta = await query<{ id: string; name: string | null; created_at: Date }>(
    "select id, name, created_at from runs where id = $1",
    [runId],
  );
  if (meta.length === 0) return null;

  const metrics = await query<MetricRow>(
    `select canonical_text, high_top_micros, avg_monthly_searches, average_cpc_micros, no_data
       from keyword_metrics where run_id = $1`,
    [runId],
  );
  return { meta: meta[0], metrics };
}

export async function compareRuns(aId: string, bId: string): Promise<CompareResult | null> {
  if (!isRunId(aId) || !isRunId(bId)) return null;

  const [a, b] = await Promise.all([loadRun(aId), loadRun(bId)]);
  if (!a || !b) return null;

  const [aSummary, bSummary] = await Promise.all([getRunSummary(aId), getRunSummary(bId)]);

  const byKeyword = new Map<string, { a?: MetricRow; b?: MetricRow }>();
  for (const m of a.metrics) byKeyword.set(m.canonical_text, { ...byKeyword.get(m.canonical_text), a: m });
  for (const m of b.metrics) byKeyword.set(m.canonical_text, { ...byKeyword.get(m.canonical_text), b: m });

  const rows: CompareRow[] = [];
  for (const [keyword, pair] of byKeyword) {
    const aHighTop = pair.a && !pair.a.no_data ? big(pair.a.high_top_micros) : null;
    const bHighTop = pair.b && !pair.b.no_data ? big(pair.b.high_top_micros) : null;
    const aVolume = pair.a && !pair.a.no_data ? big(pair.a.avg_monthly_searches) : null;
    const bVolume = pair.b && !pair.b.no_data ? big(pair.b.avg_monthly_searches) : null;

    rows.push({
      keyword,
      aHighTop,
      bHighTop,
      aVolume,
      bVolume,
      aCpc: pair.a && !pair.a.no_data ? big(pair.a.average_cpc_micros) : null,
      bCpc: pair.b && !pair.b.no_data ? big(pair.b.average_cpc_micros) : null,
      highTopDelta: aHighTop !== null && bHighTop !== null ? bHighTop - aHighTop : null,
      volumeDelta: aVolume !== null && bVolume !== null ? bVolume - aVolume : null,
      presence: pair.a && pair.b ? "both" : pair.a ? "only-a" : "only-b",
    });
  }

  // Biggest movers first; keywords present in only one run sink to the bottom,
  // since there is no movement to rank them by.
  rows.sort((x, y) => {
    if (x.presence !== "both" && y.presence === "both") return 1;
    if (y.presence !== "both" && x.presence === "both") return -1;
    return Math.abs(y.highTopDelta ?? 0) - Math.abs(x.highTopDelta ?? 0);
  });

  const label = (m: { id: string; name: string | null }) => m.name ?? `Run ${m.id.slice(0, 8)}`;

  return {
    a: { id: a.meta.id, name: label(a.meta), createdAt: a.meta.created_at.toISOString(), summary: aSummary },
    b: { id: b.meta.id, name: label(b.meta), createdAt: b.meta.created_at.toISOString(), summary: bSummary },
    rows,
    inBoth: rows.filter((r) => r.presence === "both").length,
    onlyA: rows.filter((r) => r.presence === "only-a").length,
    onlyB: rows.filter((r) => r.presence === "only-b").length,
  };
}
