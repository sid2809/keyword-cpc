import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card, StatusBadge } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { getResults, getRunSummary } from "@/lib/results";
import { query } from "@/lib/db";
import { withDefaults } from "@/lib/run-settings";
import { formatDateTime } from "@/lib/format";
import { ResultsView } from "./results-view";
import { LiveProgress } from "./live-progress";

/** Results for one run — PLAN.md §6 screen 2. */
export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  if (!(await getSession())) redirect("/login");

  const { id } = await params;
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
          <Link href="/runs" className="text-xs font-medium text-accent hover:underline">
            All runs
          </Link>
        </div>

        {finished && summary ? (
          <ResultsView
            runId={run.id}
            rows={rows}
            summary={summary}
            mode={settings.dedupMode}
            hasUpload={Number(uploadRows[0]?.n ?? 0) > 0}
          />
        ) : run.status === "failed" ? (
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-heat-red">This run stopped</h2>
            <p className="mt-1 text-sm text-text-secondary">
              It got through {run.processed} of {run.total_keywords} keywords. Nothing is lost — resuming
              continues from that point rather than starting over.
            </p>
            {run.error && (
              <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] border border-border p-3 text-xs text-text-secondary">
                {run.error}
              </pre>
            )}
            <p className="mt-3 text-xs text-text-muted">
              Resume it with <span className="num">npm run run:keywords -- --resume {run.id}</span>
            </p>
          </Card>
        ) : (
          <LiveProgress runId={run.id} initialProcessed={run.processed} total={run.total_keywords} />
        )}
      </main>
    </>
  );
}
