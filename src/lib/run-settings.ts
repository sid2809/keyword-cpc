import { createHash } from "node:crypto";
import type { DedupMode, RunSettings } from "./types";

export type { DedupMode, RunSettings };

/**
 * The knobs that define what a run asked Google for. Persisted verbatim in
 * `runs.settings` and hashed into `metrics_cache.settings_hash`, so a cached
 * payload is only reused for an identical question.
 */

export const US_GEO = "geoTargetConstants/2840";
export const ENGLISH = "languageConstants/1000";

export const DEFAULT_SETTINGS: RunSettings = {
  geoTargetConstants: [US_GEO],
  language: ENGLISH,
  network: "GOOGLE_SEARCH",
  monthsBack: 12,
  includeAdultKeywords: false,
  dedupMode: "intact",
};

export function withDefaults(partial: Partial<RunSettings> | null | undefined): RunSettings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}

/**
 * Identifies the *question* asked of the API, for cache lookups.
 *
 * Deliberately excludes `dedupMode`, which is purely a presentation choice, and
 * `monthsBack`, which changes only the length of the monthly series — the
 * cached payload always stores the longest series we fetched, so a 3-month view
 * can be served by slicing a 12-month payload.
 */
export function settingsHash(settings: RunSettings): string {
  const material = JSON.stringify({
    geo: [...settings.geoTargetConstants].sort(),
    language: settings.language,
    network: settings.network,
    adult: settings.includeAdultKeywords,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Inclusive month range ending at the last COMPLETE month.
 *
 * The current month is rejected outright by the API with INVALID_VALUE
 * (VERIFIED.md §3), so the end is always at least one month back.
 */
export function yearMonthRange(monthsBack: number, now: Date = new Date()): {
  start: { year: number; month: number };
  end: { year: number; month: number };
} {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (monthsBack - 1), 1));
  return {
    start: { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 },
    end: { year: end.getUTCFullYear(), month: end.getUTCMonth() + 1 },
  };
}
