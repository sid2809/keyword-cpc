import "server-only";
import { query } from "./db";
import { MAX_GEO_KEYWORDS, startGeoJob, type GeoNetwork } from "./geo-breakdown";
import { GEO_ALL, GEO_SHORTLIST, type GeoScope } from "./geo-shortlist";
import { parseProjectQuery } from "./project-params";
import { resolveProjectEntryIds } from "./project-table";
import { ProjectError } from "./projects";
import { CHUNK_SIZE } from "./runner";

/**
 * What a project action applies to, from a request body:
 * `{ ids: string[] }` (selected keywords) or `{ filters: "<query string>" }`
 * (every keyword matching the table's current filters; "" = whole project).
 */
export async function resolveTarget(projectId: string, body: Record<string, unknown>): Promise<string[]> {
  if (Array.isArray(body.ids)) return resolveProjectEntryIds(projectId, { ids: body.ids.map(String) });
  const filters = parseProjectQuery(new URLSearchParams(typeof body.filters === "string" ? body.filters : "")).filters;
  return resolveProjectEntryIds(projectId, { filters });
}

/** Distinct keywords per network among the entries (breakdowns are per keyword + network). */
async function keywordsByNetwork(entryIds: string[]): Promise<Map<GeoNetwork, string[]>> {
  const rows = await query<{ network: string; keywords: string[] }>(
    `select coalesce(settings->>'network', 'GOOGLE_SEARCH') as network, array_agg(distinct keyword_key) as keywords
       from project_keywords where id = any($1::bigint[]) group by 1`,
    [entryIds],
  );
  return new Map(
    rows.map((r) => [
      r.network === "GOOGLE_SEARCH_AND_PARTNERS" ? "GOOGLE_SEARCH_AND_PARTNERS" : "GOOGLE_SEARCH",
      r.keywords,
    ]),
  );
}

export type GeoPreview = { keywords: number; shortlistRequests: number; allRequests: number };

/** Upper bound: countries a keyword already has an answer for are skipped. */
export async function previewProjectGeo(entryIds: string[]): Promise<GeoPreview> {
  const groups = await keywordsByNetwork(entryIds);
  let keywords = 0;
  let perCountry = 0;
  for (const list of groups.values()) {
    keywords += list.length;
    perCountry += Math.ceil(list.length / CHUNK_SIZE);
  }
  return {
    keywords,
    shortlistRequests: perCountry * GEO_SHORTLIST.length,
    allRequests: perCountry * GEO_ALL.length,
  };
}

/** Starts one breakdown job per network. Returns how many keywords are covered. */
export async function startProjectGeo(entryIds: string[], scope: GeoScope): Promise<number> {
  const groups = await keywordsByNetwork(entryIds);
  let total = 0;
  for (const list of groups.values()) {
    if (list.length > MAX_GEO_KEYWORDS) {
      throw new ProjectError(
        `At most ${MAX_GEO_KEYWORDS.toLocaleString("en-IN")} keywords per breakdown; ${list.length.toLocaleString("en-IN")} chosen. Narrow it with filters or a selection.`,
      );
    }
    total += list.length;
  }
  if (total === 0) throw new ProjectError("No keywords to scan.");
  for (const [network, keywords] of groups) await startGeoJob({ keywords, network, scope });
  return total;
}
