/**
 * The project table's query: filters, sort, paging, and whether to show only
 * each keyword's latest numbers. Client-safe (no database imports); both the
 * page and the API parse and serialise it here so they can't drift apart.
 */

export const PROJECT_PAGE_SIZES = [50, 100, 250, 500] as const;
export type ProjectPageSize = (typeof PROJECT_PAGE_SIZES)[number];
export const PROJECT_DEFAULT_PAGE_SIZE: ProjectPageSize = 100;

export type ProjectSortKey = "added" | "keyword" | "searches" | "highTop" | "lowTop" | "fetched";
const SORT_KEYS: readonly ProjectSortKey[] = ["added", "keyword", "searches", "highTop", "lowTop", "fetched"];

/** Location filter: a geo target id, "worldwide", or null for any. */
export type ProjectFilters = {
  text: string;
  geo: string | null;
  /** A language constant id, "any" (entries fetched with no language), or null for all. */
  language: string | null;
  network: string | null;
  minSearches: number | null;
  minHighTopMicros: number | null;
  maxHighTopMicros: number | null;
  hideNoData: boolean;
};

export type ProjectQuery = {
  filters: ProjectFilters;
  sort: { key: ProjectSortKey; dir: "asc" | "desc" };
  page: number;
  pageSize: ProjectPageSize;
  latestOnly: boolean;
};

export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  text: "",
  geo: null,
  language: null,
  network: null,
  minSearches: null,
  minHighTopMicros: null,
  maxHighTopMicros: null,
  hideNoData: false,
};

export const DEFAULT_PROJECT_QUERY: ProjectQuery = {
  filters: EMPTY_PROJECT_FILTERS,
  sort: { key: "added", dir: "asc" },
  page: 1,
  pageSize: PROJECT_DEFAULT_PAGE_SIZE,
  latestOnly: true,
};

export class ProjectParamError extends Error {}

function nonNegativeInt(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return null;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new ProjectParamError(`${name} must be a whole number.`);
  }
  return Number(raw);
}

export function parseProjectQuery(params: URLSearchParams): ProjectQuery {
  const text = params.get("q") ?? "";
  if (text.length > 500) throw new ProjectParamError("The search text is too long.");

  const geo = params.get("geo");
  if (geo !== null && geo !== "worldwide" && !/^geoTargetConstants\/\d+$/.test(geo)) {
    throw new ProjectParamError("Unknown location.");
  }
  const language = params.get("lang");
  if (language !== null && language !== "any" && !/^languageConstants\/\d+$/.test(language)) {
    throw new ProjectParamError("Unknown language.");
  }
  const network = params.get("net");
  if (network !== null && network !== "GOOGLE_SEARCH" && network !== "GOOGLE_SEARCH_AND_PARTNERS") {
    throw new ProjectParamError("Unknown network.");
  }

  const sortRaw = params.get("sort") ?? "added";
  if (!(SORT_KEYS as readonly string[]).includes(sortRaw)) throw new ProjectParamError("Unknown sort.");
  const dirRaw = params.get("dir") ?? "asc";
  if (dirRaw !== "asc" && dirRaw !== "desc") throw new ProjectParamError("dir must be asc or desc.");

  const page = nonNegativeInt(params, "page") ?? 1;
  if (page < 1) throw new ProjectParamError("page starts at 1.");
  const size = nonNegativeInt(params, "size") ?? PROJECT_DEFAULT_PAGE_SIZE;
  if (!(PROJECT_PAGE_SIZES as readonly number[]).includes(size)) {
    throw new ProjectParamError(`size must be one of ${PROJECT_PAGE_SIZES.join(", ")}.`);
  }

  return {
    filters: {
      text,
      geo,
      language,
      network,
      minSearches: nonNegativeInt(params, "minVol"),
      minHighTopMicros: nonNegativeInt(params, "minBid"),
      maxHighTopMicros: nonNegativeInt(params, "maxBid"),
      hideNoData: params.get("nodata") === "hide",
    },
    sort: { key: sortRaw as ProjectSortKey, dir: dirRaw },
    page,
    pageSize: size as ProjectPageSize,
    latestOnly: params.get("latest") !== "0",
  };
}

export function projectQueryToParams(q: ProjectQuery): URLSearchParams {
  const p = new URLSearchParams();
  const f = q.filters;
  if (f.text !== "") p.set("q", f.text);
  if (f.geo !== null) p.set("geo", f.geo);
  if (f.language !== null) p.set("lang", f.language);
  if (f.network !== null) p.set("net", f.network);
  if (f.minSearches !== null) p.set("minVol", String(f.minSearches));
  if (f.minHighTopMicros !== null) p.set("minBid", String(f.minHighTopMicros));
  if (f.maxHighTopMicros !== null) p.set("maxBid", String(f.maxHighTopMicros));
  if (f.hideNoData) p.set("nodata", "hide");
  p.set("sort", q.sort.key);
  p.set("dir", q.sort.dir);
  p.set("page", String(q.page));
  p.set("size", String(q.pageSize));
  if (!q.latestOnly) p.set("latest", "0");
  return p;
}

export function projectFiltersActive(f: ProjectFilters): boolean {
  return projectQueryToParams({ ...DEFAULT_PROJECT_QUERY, filters: f }).toString() !==
    projectQueryToParams(DEFAULT_PROJECT_QUERY).toString();
}
