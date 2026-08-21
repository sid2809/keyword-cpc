import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { BTN_PRIMARY, Card, EmptyState, ProgressBar, StatusBadge } from "@/components/ui";
import { getSession } from "@/lib/session";
import { listRuns } from "@/lib/run-queries";
import { formatDateTime, formatInt, formatMicros } from "@/lib/format";

/** Runs / history — PLAN.md §6 screen 3. Compare view is parked for Phase 5. */
export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  if (!(await getSession())) redirect("/login");

  const params = await searchParams;
  const savedOnly = params.saved === "1";
  const runs = await listRuns(50, savedOnly);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-text">Runs</h1>
          <div className="flex gap-1">
            <Link
              href="/runs"
              className={
                "rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium " +
                (savedOnly ? "text-text-secondary hover:text-accent" : "bg-accent-soft text-accent")
              }
            >
              All
            </Link>
            <Link
              href="/runs?saved=1"
              className={
                "rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium " +
                (savedOnly ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-accent")
              }
            >
              ★ Saved
            </Link>
          </div>
        </div>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              title={savedOnly ? "Nothing saved yet" : "No runs yet"}
              body={
                savedOnly
                  ? "Star a run on its results page to keep it here, exempt from any future cleanup."
                  : "Paste keywords or upload a sheet to start — up to 10,000 per request."
              }
              action={
                <Link href={savedOnly ? "/runs" : "/"} className={BTN_PRIMARY}>
                  {savedOnly ? "See all runs" : "New search"}
                </Link>
              }
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-xs font-medium text-text-secondary">Name</th>
                  <th className="px-4 py-2 text-xs font-medium text-text-secondary">Tag</th>
                  <th className="px-4 py-2 text-xs font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Keywords</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Wtd top-of-page</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-0 hover:bg-accent-soft/40">
                    <td className="px-4 py-2">
                      <Link href={`/runs/${run.id}`} className="text-sm font-medium text-text hover:text-accent">
                        {run.savedForever && (
                          <span className="mr-1.5 text-heat-amber" title="Saved forever" aria-label="Saved forever">
                            ★
                          </span>
                        )}
                        {run.name ?? `Run ${run.id.slice(0, 8)}`}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-sm text-text-secondary">{run.tag ?? "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={run.status} />
                      {(run.status === "running" || run.status === "queued") && (
                        <div className="mt-1 w-24">
                          <ProgressBar value={run.processed} max={run.total} />
                        </div>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right text-text">{formatInt(run.total)}</td>
                    <td className="num px-4 py-2 text-right text-text">
                      {formatMicros(run.weightedAvgHighTopMicros)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-text-muted">
                      {formatDateTime(run.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </main>
    </>
  );
}
