import type { ReactNode } from "react";
import { Sidebar, SidebarToggle } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { PageTransition } from "./page-transition";

/**
 * App shell for every signed-in page: collapsible left sidebar, a slim top bar
 * (sidebar toggle left, theme toggle right), and the page content.
 *
 * Replaces the old top-of-page <Header />. Same destinations and the same
 * sign-out action; only the layout changed.
 *
 * Page content animates between pages (PageTransition); the top bar carries a
 * view-transition name so it stays still while the content changes.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pl-[var(--sidebar-width)] motion-safe:transition-[padding] motion-safe:duration-[var(--dur-base)] motion-safe:ease-[var(--ease-out-soft)]">
        <div
          style={{ viewTransitionName: "app-topbar" }}
          className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg/80 px-4 backdrop-blur-md"
        >
          <SidebarToggle />
          <ThemeToggle />
        </div>
        <PageTransition>{children}</PageTransition>
      </div>
    </div>
  );
}
