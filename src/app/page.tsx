import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { RecentRuns } from "@/components/recent-runs";
import { Workbench } from "./new-search/workbench";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { DEFAULT_SETTINGS } from "@/lib/run-settings";
import { CHUNK_SIZE } from "@/lib/runner";
import { recentRuns } from "@/lib/run-queries";

/** New Search — PLAN.md §6 screen 1. */
export default async function HomePage() {
  if (!(await getSession())) redirect("/login");

  const runs = await recentRuns(5);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="mb-5 text-lg font-semibold text-text">New search</h1>
        <Workbench
          defaultSettings={DEFAULT_SETTINGS}
          threshold={env.liveModeThreshold}
          chunkSize={CHUNK_SIZE}
        />
        <RecentRuns runs={runs} />
      </main>
    </>
  );
}
