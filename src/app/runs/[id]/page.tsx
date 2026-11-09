import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { isRunId } from "@/lib/compare";
import { getRunSummary } from "@/lib/results";
import { getResultsOverview, getResultsPage } from "@/lib/results-table";
import { DEFAULT_PAGE_SIZE, EMPTY_FILTERS } from "@/lib/results-params";
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

  /*
   * Only the FIRST PAGE of rows is rendered here; the table fetches further
   * pages from /api/runs/:id/results as the user pages, filters and sorts.
   * Rendering every row made a 125,000-keyword run a 308 MB response the
   * browser could not draw.
   */
  const [initialPage, overview, summary, uploadRows] = finished
    ? await Promise.all([
        getResultsPage(id, settings.dedupMode, {
          filters: EMPTY_FILTERS,
          sort: null,
          page: 1,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
        getResultsOverview(id, settings.dedupMode),
        getRunSummary(id),
        query<{ n: string; has_urls: boolean }>(
          `select count(*)::text as n,
                  coalesce(bool_or(url_column is not null), false) as has_urls
             from run_uploads where run_id = $1`,
          [id],
        ),
      ])
    : [null, null, null, [{ n: "0", has_urls: false }]];

  return (
    <AppShell>
      <PageHeader
        breadcrumb={
          <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
            <Link href="/runs" className="font-medium hover:text-text">
              All runs
            </Link>
            <span className="mx-1.5 text-text-muted" aria-hidden>
              /
            </span>
            <span className="text-text-muted">{run.name ?? `Run ${run.id.slice(0, 8)}`}</span>
          </nav>
        }
        title={run.name ?? `Run ${run.id.slice(0, 8)}`}
        meta={<StatusBadge status={run.status} />}
        description={
          <>
            {formatDateTime(run.created_at.toISOString())}
            {run.tag && <> · {run.tag}</>} · {settings.dedupMode === "intact" ? "list kept intact" : "deduped"} ·{" "}
            {settings.monthsBack}-month history
          </>
        }
        actions={
          <RunActions
            runId={run.id}
            savedForever={run.saved_forever}
            canRefresh={run.status === "done" || run.status === "failed"}
            refreshedAt={run.refreshed_at ? run.refreshed_at.toISOString() : null}
          />
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        {finished && summary && initialPage && overview ? (
          <ResultsView
            runId={run.id}
            initialPage={initialPage}
            overview={overview}
            summary={summary}
            mode={settings.dedupMode}
            hasUpload={Number(uploadRows[0]?.n ?? 0) > 0}
            hasDeltas={run.refresh_count > 0}
            hasUrls={uploadRows[0]?.has_urls ?? false}
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
    </AppShell>
  );
}
