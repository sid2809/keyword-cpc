import { COUNTRIES, type Country } from "./countries";

/**
 * The countries a breakdown scans first (about 30 seconds at 1 request per
 * second); "Scan all countries" covers the rest. Chosen by the owner as large
 * Google Search markets; edit the codes here to change the shortlist.
 */
const SHORTLIST_CODES = [
  "US", "IN", "GB", "CA", "AU", "DE", "FR", "BR", "MX", "ID",
  "JP", "PH", "IT", "ES", "NL", "TR", "KR", "VN", "TH", "PK",
  "BD", "NG", "ZA", "EG", "SA", "AE", "AR", "CO", "PL", "MY",
] as const;

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Shortlist countries that exist in Google's list, in shortlist order. */
export const GEO_SHORTLIST: readonly Country[] = SHORTLIST_CODES.map((code) => BY_CODE.get(code)).filter(
  (c): c is Country => c !== undefined,
);

const SHORTLIST_IDS = new Set(GEO_SHORTLIST.map((c) => c.id));

/** Every country: shortlist first, then the rest alphabetically. */
export const GEO_ALL: readonly Country[] = [...GEO_SHORTLIST, ...COUNTRIES.filter((c) => !SHORTLIST_IDS.has(c.id))];

export type GeoScope = "shortlist" | "all";
