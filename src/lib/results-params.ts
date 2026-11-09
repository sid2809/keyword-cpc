/**
 * The results table's query — filters, sort and page — as one value that both
 * the browser and the server understand.
 *
 * The results page used to ship every row of a run to the browser and filter
 * and sort there. On a 125,000-keyword run that was a 308 MB response and a
 * table the browser could not draw. Filtering, sorting and paging now happen
 * in Postgres; this module is the contract between the two sides, so a filter
 * means exactly the same thing in the URL, in the API and in SQL.
 *
 * Client-safe: no Node imports, no server-only marker.
 */

export type SortKey = "position" | "keyword" | "lowTop" | "highTop" | "cpc" | "volume" | "competition";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

export const SORT_KEYS: readonly SortKey[] = [
  "position",
  "keyword",
  "lowTop",
  "highTop",
  "cpc",
  "volume",
  "competition",
];

export type Competition = "LOW" | "MEDIUM" | "HIGH";
export const COMPETITION_VALUES: readonly Competition[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * Every filter the results table offers. Money is in MICROS, exactly as stored,
 * so no rupee rounding happens between the input box and the database.
 */
export type ResultsFilters = {
  /** Case-insensitive substring of the keyword. Empty = no text filter. */
  text: string;
  /** Inclusive lower bound on the high top-of-page bid, micros. */
  minHighTopMicros: number | null;
  /** Inclusive upper bound on the high top-of-page bid, micros. */
  maxHighTopMicros: number | null;
  /** Histogram bar: from inclusive, to exclusive, micros. */
  bucket: { from: number; to: number } | null;
  /** Inclusive lower bound on average monthly searches. */
  minVolume: number | null;
  competition: Competition | null;
  hideNoData: boolean;
};

export const EMPTY_FILTERS: ResultsFilters = {
  text: "",
  minHighTopMicros: null,
  maxHighTopMicros: null,
  bucket: null,
  minVolume: null,
  competition: null,
  hideNoData: false,
};

export const PAGE_SIZES = [50, 100, 250, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 100;

/** Longest text filter accepted. Keywords themselves are capped at 500. */
export const MAX_FILTER_TEXT = 500;

export type ResultsQuery = {
  filters: ResultsFilters;
  /** null = the run's default order (see defaultSort). */
  sort: SortState | null;
  /** 1-based. */
  page: number;
  pageSize: PageSize;
};

/**
 * The order a run opens in: highest top-of-page bid first for deduped runs,
 * the user's own row order for intact ones.
 */
export function defaultSort(mode: "intact" | "deduped"): SortState {
  return mode === "intact" ? { key: "position", dir: "asc" } : { key: "highTop", dir: "desc" };
}

export function filtersActive(f: ResultsFilters): boolean {
  return (
    f.text !== "" ||
    f.minHighTopMicros !== null ||
    f.maxHighTopMicros !== null ||
    f.minVolume !== null ||
    f.competition !== null ||
    f.bucket !== null
  );
}

// --- serialisation ----------------------------------------------------------
//
// Query-string form, used by the GET endpoints. Parsing is strict: anything
// malformed is an error the caller turns into a 400, never silently dropped,
// so a broken client cannot receive a "filtered" result that ignored a filter.

export class ResultsParamError extends Error {}

const INT_RE = /^-?\d+$/;

function parseIntParam(params: URLSearchParams, name: string, min: number): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return null;
  if (!INT_RE.test(raw)) throw new ResultsParamError(`${name} must be a whole number.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) throw new ResultsParamError(`${name} is out of range.`);
  return n;
}

export function parseFilters(params: URLSearchParams): ResultsFilters {
  const text = params.get("q") ?? "";
  if (text.length > MAX_FILTER_TEXT) throw new ResultsParamError("Search text is too long.");

  const competitionRaw = params.get("competition");
  let competition: Competition | null = null;
  if (competitionRaw !== null && competitionRaw !== "") {
    if (!(COMPETITION_VALUES as readonly string[]).includes(competitionRaw)) {
      throw new ResultsParamError("competition must be LOW, MEDIUM or HIGH.");
    }
    competition = competitionRaw as Competition;
  }

  const bucketFrom = parseIntParam(params, "bucketFrom", Number.MIN_SAFE_INTEGER);
  const bucketTo = parseIntParam(params, "bucketTo", Number.MIN_SAFE_INTEGER);
  if ((bucketFrom === null) !== (bucketTo === null)) {
    throw new ResultsParamError("bucketFrom and bucketTo must be sent together.");
  }
  if (bucketFrom !== null && bucketTo !== null && bucketTo <= bucketFrom) {
    throw new ResultsParamError("bucketTo must be greater than bucketFrom.");
  }

  const hide = params.get("hideNoData");
  if (hide !== null && hide !== "0" && hide !== "1") throw new ResultsParamError("hideNoData must be 0 or 1.");

  return {
    text,
    minHighTopMicros: parseIntParam(params, "minTop", 0),
    maxHighTopMicros: parseIntParam(params, "maxTop", 0),
    bucket: bucketFrom !== null && bucketTo !== null ? { from: bucketFrom, to: bucketTo } : null,
    minVolume: parseIntParam(params, "minVolume", 0),
    competition,
    hideNoData: hide === "1",
  };
}

export function parseSort(params: URLSearchParams): SortState | null {
  const key = params.get("sort");
  const dir = params.get("dir");
  if ((key === null || key === "") && (dir === null || dir === "")) return null;
  if (key === null || !(SORT_KEYS as readonly string[]).includes(key)) {
    throw new ResultsParamError(`sort must be one of ${SORT_KEYS.join(", ")}.`);
  }
  if (dir !== "asc" && dir !== "desc") throw new ResultsParamError("dir must be asc or desc.");
  return { key: key as SortKey, dir };
}

export function parseResultsQuery(params: URLSearchParams): ResultsQuery {
  const page = parseIntParam(params, "page", 1) ?? 1;
  const sizeRaw = parseIntParam(params, "pageSize", 1) ?? DEFAULT_PAGE_SIZE;
  if (!(PAGE_SIZES as readonly number[]).includes(sizeRaw)) {
    throw new ResultsParamError(`pageSize must be one of ${PAGE_SIZES.join(", ")}.`);
  }
  return { filters: parseFilters(params), sort: parseSort(params), page, pageSize: sizeRaw as PageSize };
}

export function filtersToParams(f: ResultsFilters, out = new URLSearchParams()): URLSearchParams {
  if (f.text !== "") out.set("q", f.text);
  if (f.minHighTopMicros !== null) out.set("minTop", String(f.minHighTopMicros));
  if (f.maxHighTopMicros !== null) out.set("maxTop", String(f.maxHighTopMicros));
  if (f.bucket !== null) {
    out.set("bucketFrom", String(f.bucket.from));
    out.set("bucketTo", String(f.bucket.to));
  }
  if (f.minVolume !== null) out.set("minVolume", String(f.minVolume));
  if (f.competition !== null) out.set("competition", f.competition);
  if (f.hideNoData) out.set("hideNoData", "1");
  return out;
}

export function sortToParams(s: SortState | null, out = new URLSearchParams()): URLSearchParams {
  if (s !== null) {
    out.set("sort", s.key);
    out.set("dir", s.dir);
  }
  return out;
}

export function resultsQueryToParams(q: ResultsQuery): URLSearchParams {
  const out = new URLSearchParams();
  filtersToParams(q.filters, out);
  sortToParams(q.sort, out);
  out.set("page", String(q.page));
  out.set("pageSize", String(q.pageSize));
  return out;
}

/**
 * Converts what the user typed in a rupee box into micros, or null when the
 * box is empty. Returns NaN for text that is not a non-negative number, so the
 * caller can show it as invalid instead of quietly ignoring it.
 */
export function rupeesInputToMicros(input: string): number | null {
  const s = input.trim();
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  // Rupees have at most 2 meaningful decimals in this app, but the old filter
  // multiplied whatever was typed by 1,000,000; round to whole micros, which
  // is the unit stored in the database.
  return Math.round(Number(s) * 1_000_000);
}

/** Same contract as rupeesInputToMicros, for a whole-number count. */
export function countInputToNumber(input: string): number | null {
  const s = input.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}
