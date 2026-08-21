import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
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
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text">Keyword CPC</h1>
          <ThemeToggle />
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <p className="mb-5 text-sm text-text-secondary">
            This tool is private. Enter the app password to continue.
          </p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
