"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Column-visibility preference, persisted across runs and reloads
 * (PLAN.md §7 Phase 5, "sparkline toggle persistence").
 *
 * localStorage is read through `useSyncExternalStore` rather than an effect:
 * the server has no storage, so `getServerSnapshot` returns null and the first
 * client render matches it, then React re-renders with the stored value. That
 * avoids both a hydration mismatch and a setState-in-effect.
 */

const STORAGE_KEY = "kcpc.columns";

const listeners = new Set<() => void>();

// getSnapshot must return a STABLE reference for an unchanged value, or React
// re-renders forever. Cache the parse, keyed by the raw string.
let cachedRaw: string | null | undefined;
let cachedValue: string[] | null = null;

function readStorage(): string[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled.
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    if (raw === null) {
      cachedValue = null;
    } else {
      try {
        const parsed: unknown = JSON.parse(raw);
        cachedValue = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
      } catch {
        cachedValue = null;
      }
    }
  }
  return cachedValue;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires in OTHER tabs; same-tab writes notify through `listeners`.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function serverSnapshot(): string[] | null {
  return null;
}

export function useStoredColumns(): [string[] | null, (next: string[]) => void] {
  const stored = useSyncExternalStore(subscribe, readStorage, serverSnapshot);

  const store = useCallback((next: string[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the toggle still applies to this page view.
    }
    // Invalidate the cache so the next snapshot re-parses, then notify.
    cachedRaw = undefined;
    for (const l of listeners) l();
  }, []);

  return [stored, store];
}
