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

/**
 * Sanitises caller-supplied settings field by field, falling back to the
 * default for anything malformed.
 *
 * A merge alone was not enough: `{ geoTargetConstants: "x" }` used to be
 * accepted, the run created, and only then rejected by Google with
 * `RESOURCE_NAME_MALFORMED: Resource name 'x' is malformed` — a cryptic
 * failure, after the work of creating the run, for something knowable up front.
 */
const GEO_RE = /^geoTargetConstants\/\d+$/;
const LANG_RE = /^languageConstants\/\d+$/;

export function withDefaults(partial: Partial<RunSettings> | null | undefined): RunSettings {
  if (typeof partial !== "object" || partial === null || Array.isArray(partial)) {
    return { ...DEFAULT_SETTINGS };
  }

  const geo = Array.isArray(partial.geoTargetConstants)
    ? partial.geoTargetConstants.filter((g): g is string => typeof g === "string" && GEO_RE.test(g))
    : [];

  return {
    // The API caps geo targets at 10 per request.
    geoTargetConstants: geo.length > 0 ? geo.slice(0, 10) : DEFAULT_SETTINGS.geoTargetConstants,
    language:
      partial.language === null
        ? null
        : typeof partial.language === "string" && LANG_RE.test(partial.language)
          ? partial.language
          : DEFAULT_SETTINGS.language,
    network:
      partial.network === "GOOGLE_SEARCH" || partial.network === "GOOGLE_SEARCH_AND_PARTNERS"
        ? partial.network
        : DEFAULT_SETTINGS.network,
    monthsBack:
      partial.monthsBack === 3 || partial.monthsBack === 6 || partial.monthsBack === 12
        ? partial.monthsBack
        : DEFAULT_SETTINGS.monthsBack,
    includeAdultKeywords:
      typeof partial.includeAdultKeywords === "boolean"
        ? partial.includeAdultKeywords
        : DEFAULT_SETTINGS.includeAdultKeywords,
    dedupMode:
      partial.dedupMode === "intact" || partial.dedupMode === "deduped"
        ? partial.dedupMode
        : DEFAULT_SETTINGS.dedupMode,
  };
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
