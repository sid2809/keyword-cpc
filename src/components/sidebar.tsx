"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  ChartNoAxesColumn,
  GitCompareArrows,
  History,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/login/actions";

/**
 * Left sidebar: icon + label navigation to the app's existing pages.
 *
 * Opens COLLAPSED (icons only) by default; the choice is remembered in
 * localStorage under "sidebar". The `data-sidebar` attribute on <html> is set
 * before first paint by the inline script in layout.tsx, so the width never
 * jumps on load. Labels hide via CSS (globals.css), and every link keeps an
 * aria-label and tooltip so the collapsed rail stays usable.
 */

const NAV: { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }[] = [
  { href: "/", label: "New search", icon: Search, match: (p) => p === "/" },
  { href: "/runs", label: "Runs", icon: History, match: (p) => p === "/runs" || p.startsWith("/runs/") },
  { href: "/compare", label: "Compare", icon: GitCompareArrows, match: (p) => p.startsWith("/compare") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

const ITEM =
  "flex h-9 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Main navigation"
      className="sidebar-nav fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar motion-safe:transition-[width] motion-safe:duration-150"
    >
      <Link href="/" aria-label="Keyword CPC — New search" title="Keyword CPC" className="flex h-12 shrink-0 items-center gap-3 border-b border-sidebar-border px-3.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent text-on-accent">
          <ChartNoAxesColumn size={16} strokeWidth={2.25} aria-hidden />
        </span>
        <span className="sidebar-label truncate text-sm font-semibold text-sidebar-text-strong">Keyword CPC</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              title={label}
              aria-current={active ? "page" : undefined}
              className={
                ITEM +
                " relative " +
                (active
                  ? "bg-sidebar-active text-sidebar-text-strong before:absolute before:inset-y-1.5 before:-left-2 before:w-0.5 before:rounded-full before:bg-sidebar-accent"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-strong")
              }
            >
              <Icon size={16} className={"shrink-0 " + (active ? "text-sidebar-accent" : "")} aria-hidden />
              <span className="sidebar-label truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <form action={logout} className="border-t border-sidebar-border p-2">
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className={`${ITEM} w-full text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-strong`}
        >
          <LogOut size={16} className="shrink-0" aria-hidden />
          <span className="sidebar-label truncate">Sign out</span>
        </button>
      </form>
    </aside>
  );
}

// --- collapse toggle ---------------------------------------------------------

type SidebarState = "collapsed" | "expanded";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => observer.disconnect();
}

function getSnapshot(): SidebarState {
  return document.documentElement.getAttribute("data-sidebar") === "expanded" ? "expanded" : "collapsed";
}

function getServerSnapshot(): null {
  return null;
}

export function SidebarToggle() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: SidebarState = state === "expanded" ? "collapsed" : "expanded";
    document.documentElement.setAttribute("data-sidebar", next);
    try {
      localStorage.setItem("sidebar", next);
    } catch {
      // Storage unavailable — the toggle still applies to this page view.
    }
  }

  const label = state === "expanded" ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-expanded={state === null ? undefined : state === "expanded"}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-secondary hover:bg-subtle hover:text-text"
    >
      {state === null ? (
        <span className="block h-4 w-4" aria-hidden />
      ) : state === "expanded" ? (
        <PanelLeftClose size={16} aria-hidden />
      ) : (
        <PanelLeftOpen size={16} aria-hidden />
      )}
    </button>
  );
}
