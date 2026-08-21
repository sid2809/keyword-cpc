import "server-only";
import { query } from "./db";
import { executeRun } from "./runner";

/**
 * Mutations on an existing run — Phase 4: save forever, delete, refresh.
 */

export async function setSavedForever(runId: string, saved: boolean): Promise<void> {
  await query("update runs set saved_forever = $2, updated_at = now() where id = $1", [runId, saved]);
}

export async function deleteRun(runId: string): Promise<void> {
  // run_keywords, keyword_metrics and run_uploads all cascade from runs.
  // metrics_cache is deliberately NOT touched — it is shared across runs and
  // keyed by keyword, so clearing it here would slow down every other run.
  await query("delete from runs where id = $1", [runId]);
}

export async function renameRun(runId: string, name: string | null, tag: string | null): Promise<void> {
  await query("update runs set name = $2, tag = $3, updated_at = now() where id = $1", [
    runId,
    name?.trim() || null,
    tag?.trim() || null,
  ]);
}

/**
 * Re-pulls a finished run from the API and records per-keyword movement.
 *
 * Snapshots the current values into the `prev_*` columns first, then rewinds
 * the run and re-executes it with the cache bypassed. Without the bypass the
 * same-calendar-month rule would serve the cached payload straight back and
 * every delta would be zero.
 */
export async function refreshRun(runId: string): Promise<void> {
  const rows = await query<{ status: string }>("select status from runs where id = $1", [runId]);
  if (rows.length === 0) throw new Error("Run not found");
  if (rows[0].status === "running" || rows[0].status === "queued") {
    throw new Error("That run is still going — wait for it to finish before refreshing.");
  }

  await query(
    `update keyword_metrics
        set prev_average_cpc_micros   = average_cpc_micros,
            prev_avg_monthly_searches = avg_monthly_searches,
            prev_low_top_micros       = low_top_micros,
            prev_high_top_micros      = high_top_micros
      where run_id = $1`,
    [runId],
  );

  await query(
    `update runs
        set status = 'queued', chunk_cursor = 0, processed = 0, error = null,
            bypass_cache = true, refreshed_at = now(), refresh_count = refresh_count + 1,
            updated_at = now()
      where id = $1`,
    [runId],
  );

  // Fire and forget; the page polls /api/runs/:id/progress like any other run.
  void executeRun(runId).catch((err) => {
    console.error(`[runner] refresh of ${runId} failed:`, err instanceof Error ? err.message : err);
  });
}
