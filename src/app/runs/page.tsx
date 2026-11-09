import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BTN_PRIMARY, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { listRuns } from "@/lib/run-queries";
import { RunsTable } from "./runs-table";
import { PillTrack } from "@/components/pill-track";

/** Runs / history — PLAN.md §6 screen 3. */
export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  if (!(await getSession())) redirect("/login");

  const params = await searchParams;
  const savedOnly = params.saved === "1";
  const runs = await listRuns(50, savedOnly);

  return (
    <AppShell>
      <PageHeader
        title="Runs"
        description="Every search you have run. Tick two finished runs to compare them."
        actions={
          <nav aria-label="Filter runs">
            <PillTrack
              className="inline-flex rounded-[var(--radius-control)] border border-border bg-subtle p-0.5"
              pillClassName="rounded-[4px]"
            >
            <Link
              href="/runs"
              aria-current={savedOnly ? undefined : "page"}
              data-active={!savedOnly}
              className={
                "rounded-[4px] px-3 py-1 text-xs font-medium " +
                (savedOnly
                  ? "text-text-secondary hover:text-text"
                  : "bg-surface text-text shadow-card ring-1 ring-border")
              }
            >
              All
            </Link>
            <Link
              href="/runs?saved=1"
              aria-current={savedOnly ? "page" : undefined}
              data-active={savedOnly}
              className={
                "rounded-[4px] px-3 py-1 text-xs font-medium " +
                (savedOnly
                  ? "bg-surface text-text shadow-card ring-1 ring-border"
                  : "text-text-secondary hover:text-text")
              }
            >
              ★ Saved
            </Link>
            </PillTrack>
          </nav>
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">

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
          <RunsTable runs={runs} />
        )}
      </main>
    </AppShell>
  );
}
