import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { BTN_PRIMARY, Card, EmptyState } from "@/components/ui";
import { getSession } from "@/lib/session";
import { listRuns } from "@/lib/run-queries";
import { RunsTable } from "./runs-table";

/** Runs / history — PLAN.md §6 screen 3. */
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
          <RunsTable runs={runs} />
        )}
      </main>
    </>
  );
}
