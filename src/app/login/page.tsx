import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { ChartNoAxesColumn } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSession } from "@/lib/session";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Authoritative check, so a stale or forged cookie falls through to the form
  // instead of ping-ponging with the proxy.
  if (await getSession()) redirect("/");

  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
      {/* Faint accent glow behind the card (allowed on login, never behind data). */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="flex items-center gap-2.5 text-lg font-semibold text-text">
            <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-gradient-to-br from-accent to-accent-hover text-on-accent shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_4px_12px_-2px_rgb(99_102_241/0.5)]">
              <ChartNoAxesColumn size={16} strokeWidth={2.25} aria-hidden />
            </span>
            Keyword CPC
          </h1>
          <ThemeToggle />
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-overlay">
          <p className="mb-5 text-sm text-text-secondary">
            This tool is private. Enter the app password to continue.
          </p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
