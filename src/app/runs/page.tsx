import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { getSession } from "@/lib/session";

/** Stub — the real Runs/History screen (§6 screen 3) is built in Phase 4. */
export default async function RunsPage() {
  if (!(await getSession())) redirect("/login");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold text-text">Runs</h1>
        <p className="mt-1 text-sm text-text-secondary">Run history arrives in Phase 4.</p>
      </main>
    </>
  );
}
