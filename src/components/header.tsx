import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { logout } from "@/app/login/actions";

/** App header (§6): name left; theme toggle, Runs, Settings right. */
export function Header() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-sm font-semibold text-text">
          Keyword CPC
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href="/runs"
            className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-text-secondary hover:bg-accent-soft hover:text-accent"
          >
            Runs
          </Link>
          <Link
            href="/settings"
            className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-text-secondary hover:bg-accent-soft hover:text-accent"
          >
            Settings
          </Link>
          <ThemeToggle />
          <form action={logout}>
            <button
              type="submit"
              className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-text-secondary hover:bg-accent-soft hover:text-accent"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
