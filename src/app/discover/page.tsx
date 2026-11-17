import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { defaultRunSettings } from "@/lib/app-settings";
import { DiscoverForm } from "./discover-form";

/** Discover — find new keywords from seeds. */
export default async function DiscoverPage() {
  if (!(await getSession())) redirect("/login");
  const settings = await defaultRunSettings();

  return (
    <AppShell>
      <PageHeader
        title="Discover"
        description="Give Google a keyword, a page or a website and get the keywords it suggests, with their bids and search volume."
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        <DiscoverForm defaultSettings={settings} />
      </main>
    </AppShell>
  );
}
