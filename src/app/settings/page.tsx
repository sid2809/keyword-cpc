import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { getSession } from "@/lib/session";
import { env, envHealth } from "@/lib/env";

/** Stub — the full Settings screen (§6 screen 4) is built in Phase 4. */
export default async function SettingsPage() {
  if (!(await getSession())) redirect("/login");

  const vars = envHealth();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Editable settings and the API health probe arrive in Phase 4. Current configuration:
        </p>

        <div className="mt-6 rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-secondary">Live-mode threshold</dt>
              <dd className="num text-text">{env.liveModeThreshold.toLocaleString("en-IN")}</dd>
            </div>
            {vars.map((v) => (
              <div key={v.key} className="flex items-center justify-between">
                <dt className="num text-text-secondary">{v.key}</dt>
                <dd className={v.present ? "text-sm text-heat-green" : "text-sm text-heat-red"}>
                  {v.present ? "set" : "missing"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </main>
    </>
  );
}
