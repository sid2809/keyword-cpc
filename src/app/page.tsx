import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { RecentRuns } from "@/components/recent-runs";
import { Workbench } from "./new-search/workbench";
import { getSession } from "@/lib/session";
import { defaultRunSettings, getAppSettings } from "@/lib/app-settings";
import { CHUNK_SIZE } from "@/lib/runner";
import { recentRuns } from "@/lib/run-queries";

/** New Search — PLAN.md §6 screen 1. */
export default async function HomePage() {
  if (!(await getSession())) redirect("/login");

  const [runs, settings, appSettings] = await Promise.all([
    recentRuns(5),
    defaultRunSettings(),
    getAppSettings(),
  ]);

  return (
    <AppShell>
      <PageHeader
        title="New search"
        description="Paste or upload keywords to pull top-of-page bids, CPC and search volume from Google Ads."
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        <Workbench
          defaultSettings={settings}
          threshold={appSettings.liveModeThreshold}
          chunkSize={CHUNK_SIZE}
        />
        <RecentRuns runs={runs} />
      </main>
    </AppShell>
  );
}
