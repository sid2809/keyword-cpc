"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Sun/moon toggle (§5).
 *
 * The `data-theme` attribute on <html> is the source of truth; the inline
 * script in the root layout sets it before first paint. This component reads
 * that attribute as an external store rather than mirroring it into React
 * state, so there is no hydration mismatch and no setState-in-effect.
 */

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** No DOM on the server — render the neutral placeholder for the first pass. */
function getServerSnapshot(): null {
  return null;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing / storage disabled — the toggle still works for this page.
    }
  }

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-secondary hover:bg-subtle hover:text-text"
    >
      {theme === null ? (
        <span className="block h-4 w-4" aria-hidden />
      ) : theme === "dark" ? (
        <Sun size={16} aria-hidden />
      ) : (
        <Moon size={16} aria-hidden />
      )}
    </button>
  );
}
