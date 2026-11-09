import type { ReactNode } from "react";
import { Sidebar, SidebarToggle } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

/**
 * App shell for every signed-in page: collapsible left sidebar, a slim top bar
 * (sidebar toggle left, theme toggle right), and the page content.
 *
 * Replaces the old top-of-page <Header />. Same destinations and the same
 * sign-out action; only the layout changed.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pl-[var(--sidebar-width)] motion-safe:transition-[padding] motion-safe:duration-150">
        <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg px-4">
          <SidebarToggle />
          <ThemeToggle />
        </div>
        {children}
      </div>
    </div>
  );
}
