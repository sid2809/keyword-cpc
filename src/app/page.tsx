import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { getSession } from "@/lib/session";
import { pingDb } from "@/lib/db";
import { envHealth } from "@/lib/env";

/**
 * Phase 0 placeholder. The real two-panel workbench (PLAN.md §6 screen 1)
 * arrives in Phase 3; for now this page proves the auth + DB + env plumbing
 * works end to end.
 */
export default async function HomePage() {
  // Authoritative session check — proxy.ts only did an optimistic cookie test.
  if (!(await getSession())) redirect("/login");

  const db = await pingDb();
  const env = envHealth();
  const missing = env.filter((e) => !e.present);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold text-text">Skeleton is up</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Phase 0 complete: Next.js, Postgres, login and env plumbing. The New Search workbench
          lands in Phase 3.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <h2 className="text-sm font-medium text-text">Database</h2>
            {db.ok ? (
              <>
                <p className="mt-2 text-sm text-heat-green">Connected</p>
                <p className="mt-1 text-xs text-text-muted">{db.serverVersion.split(" on ")[0]}</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-heat-red">Not connected</p>
                <p className="mt-1 text-xs text-text-muted">{db.error}</p>
              </>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <h2 className="text-sm font-medium text-text">Environment</h2>
            {missing.length === 0 ? (
              <p className="mt-2 text-sm text-heat-green">All {env.length} variables set</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-heat-amber">{missing.length} missing</p>
                <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                  {missing.map((e) => (
                    <li key={e.key} className="num">
                      {e.key}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <p className="mt-8 text-xs text-text-muted">
          Next up — Phase 1: run <span className="num">npm run check:token</span>, then the Keyword
          Planner smoke test against the PLAN.md §2 VERIFY list.
        </p>
      </main>
    </>
  );
}
