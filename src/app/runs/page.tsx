import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { BTN_PRIMARY, Card, EmptyState, ProgressBar, StatusBadge } from "@/components/ui";
import { getSession } from "@/lib/session";
import { listRuns } from "@/lib/run-queries";
import { formatDateTime, formatInt, formatMicros } from "@/lib/format";

/** Runs / history — PLAN.md §6 screen 3. Compare view is parked for Phase 5. */
export default async function RunsPage() {
  if (!(await getSession())) redirect("/login");

  const runs = await listRuns(50);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="mb-5 text-lg font-semibold text-text">Runs</h1>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              title="No runs yet"
              body="Paste keywords or upload a sheet to start — up to 10,000 per request."
              action={
                <Link href="/" className={BTN_PRIMARY}>
                  New search
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
