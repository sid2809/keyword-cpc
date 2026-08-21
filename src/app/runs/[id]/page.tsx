import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { StatusBadge } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { isRunId } from "@/lib/compare";
import { getResults, getRunSummary } from "@/lib/results";
import { query } from "@/lib/db";
import { withDefaults } from "@/lib/run-settings";
import { formatDateTime } from "@/lib/format";
import { ResultsView } from "./results-view";
import { LiveProgress } from "./live-progress";
import { RunActions } from "./run-actions";
import { FailedRun } from "./failed-run";

/** Results for one run — PLAN.md §6 screen 2. */
export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  if (!(await getSession())) redirect("/login");

  const { id } = await params;
  // A malformed id would make Postgres throw rather than return no rows.
  if (!isRunId(id)) notFound();
  const run = await getRun(id);
  if (!run) notFound();

  const settings = withDefaults(run.settings);
  const finished = run.status === "done";

  const [rows, summary, uploadRows] = finished
    ? await Promise.all([
        getResults(id, settings.dedupMode),
        getRunSummary(id),
        query<{ n: string }>("select count(*)::text as n from run_uploads where run_id = $1", [id]),
      ])
    : [[], null, [{ n: "0" }]];

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-text">
                {run.name ?? `Run ${run.id.slice(0, 8)}`}
              </h1>
              <StatusBadge status={run.status} />
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {formatDateTime(run.created_at.toISOString())}
              {run.tag && <> · {run.tag}</>} · {settings.dedupMode === "intact" ? "list kept intact" : "deduped"} ·{" "}
              {settings.monthsBack}-month history
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <RunActions
              runId={run.id}
              savedForever={run.saved_forever}
              canRefresh={run.status === "done" || run.status === "failed"}
              refreshedAt={run.refreshed_at ? run.refreshed_at.toISOString() : null}
            />
            <Link href="/runs" className="text-xs font-medium text-accent hover:underline">
              All runs
            </Link>
          </div>
        </div>

        {finished && summary ? (
          <ResultsView
            runId={run.id}
            rows={rows}
            summary={summary}
            mode={settings.dedupMode}
            hasUpload={Number(uploadRows[0]?.n ?? 0) > 0}
            hasDeltas={run.refresh_count > 0}
          />
        ) : run.status === "failed" ? (
          <FailedRun
            runId={run.id}
            processed={run.processed}
            total={run.total_keywords}
            error={run.error}
          />
        ) : (
          <LiveProgress runId={run.id} initialProcessed={run.processed} total={run.total_keywords} />
        )}
      </main>
    </>
  );
}
