/**
 * Runs once when a server instance boots (Next's `register` hook).
 *
 * PLAN.md §3: "Runs must survive a server restart: persist chunk cursor in DB;
 * on boot, resume any `running` jobs."
 *
 * `register` must complete before the server starts handling requests, so the
 * resume is deliberately NOT awaited — a large interrupted run would otherwise
 * hold up startup for minutes. It proceeds in the background while the app
 * serves traffic, and the Runs screen shows its progress from the DB.
 */
export async function register() {
  // `register` is invoked for the edge runtime too, where pg cannot load.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the edge bundle never pulls in pg.
  const { resumeInterruptedRuns } = await import("./lib/runner");

  void resumeInterruptedRuns((e) => {
    console.log(
      `[runner] run ${e.runId}: chunk ${e.chunkIndex + 1}/${e.totalChunks}, ` +
        `${e.processed}/${e.total} keywords (${e.fromCache} cached, ${e.fromApi} fetched)`,
    );
  })
    .then((ids) => {
      if (ids.length > 0) console.log(`[runner] resumed ${ids.length} interrupted run(s) at boot`);
    })
    .catch((err) => {
      console.error("[runner] boot resume failed:", err instanceof Error ? err.message : err);
    });
}
