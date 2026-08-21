import "server-only";
import { query } from "./db";
import type { RunListItem } from "./types";

/**
 * Read queries used by server components. Kept out of runner.ts so pages don't
 * pull the executor (and the Google Ads client) into their module graph.
 */

/**
 * The volume-weighted average CPC is computed in SQL so the runs list doesn't
 * have to load every keyword row just to show one number per run.
 */
const WEIGHTED_CPC = `
  (select case when sum(km.avg_monthly_searches) > 0
               then round(sum(km.average_cpc_micros * km.avg_monthly_searches)
                          / sum(km.avg_monthly_searches))
               else avg(km.average_cpc_micros)
          end
     from keyword_metrics km
    where km.run_id = r.id
      and km.no_data = false
      and km.average_cpc_micros is not null) as weighted`;

type Row = {
  id: string;
  name: string | null;
  tag: string | null;
  status: RunListItem["status"];
  processed: number;
  total_keywords: number;
  created_at: Date;
  weighted: string | null;
};

function toItem(r: Row): RunListItem {
  return {
    id: r.id,
    name: r.name,
    tag: r.tag,
    status: r.status,
    processed: r.processed,
    total: r.total_keywords,
    createdAt: r.created_at.toISOString(),
    weightedAvgCpcMicros: r.weighted === null ? null : Math.round(Number(r.weighted)),
  };
}

export async function listRuns(limit = 50): Promise<RunListItem[]> {
  const rows = await query<Row>(
    `select r.id, r.name, r.tag, r.status, r.processed, r.total_keywords, r.created_at, ${WEIGHTED_CPC}
       from runs r order by r.created_at desc limit $1`,
    [limit],
  );
  return rows.map(toItem);
}

export async function recentRuns(limit = 5): Promise<RunListItem[]> {
  return listRuns(limit);
}
