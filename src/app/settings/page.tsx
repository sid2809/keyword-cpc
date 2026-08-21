import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/session";
import { envHealth } from "@/lib/env";
import { getAppSettings } from "@/lib/app-settings";
import { API_VERSION } from "@/lib/google-ads";
import { CHUNK_SIZE } from "@/lib/runner";
import { formatInt } from "@/lib/format";
import { ConnectionTest, SettingsForm } from "./settings-form";

/** Settings — PLAN.md §6 screen 4. */
export default async function SettingsPage() {
  if (!(await getSession())) redirect("/login");

  const [settings, vars] = await Promise.all([getAppSettings(), Promise.resolve(envHealth())]);
  const missing = vars.filter((v) => !v.present);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <h1 className="mb-5 text-lg font-semibold text-text">Settings</h1>

        <div className="space-y-4">
          <SettingsForm
            threshold={settings.liveModeThreshold}
            geo={settings.defaultGeo}
            language={settings.defaultLanguage}
          />

          <ConnectionTest />

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-text">Environment</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Presence only — values are never read into the page.
            </p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {vars.map((v) => (
                <div key={v.key} className="flex items-center justify-between gap-4">
                  <dt className="num text-xs text-text-secondary">{v.key}</dt>
                  <dd className={`text-xs ${v.present ? "text-heat-green" : "text-heat-red"}`}>
                    {v.present ? "set" : "missing"}
                  </dd>
                </div>
              ))}
            </dl>
            {missing.length > 0 && (
              <p className="mt-3 text-xs text-heat-red">
                {missing.length} variable{missing.length === 1 ? "" : "s"} missing — see .env.example.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-text">Fixed limits</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Google Ads API version" value={API_VERSION} />
              <Row label="Keywords per request" value={formatInt(10_000)} />
              <Row label="Chunk size" value={formatInt(CHUNK_SIZE)} />
              <Row label="Rate limit" value="1 request / second" />
              <Row label="Daily quota (basic access)" value="15,000 operations" />
              <Row label="Cache reuse" value="same calendar month" />
            </dl>
            <p className="mt-3 text-xs text-text-muted">
              These come from Google, not from configuration. See VERIFIED.md §5 and §6.
            </p>
          </Card>
        </div>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="num text-xs text-text">{value}</dd>
    </div>
  );
}
