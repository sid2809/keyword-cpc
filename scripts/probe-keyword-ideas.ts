/**
 * Discover feature, step 0 — real-Google check of generateKeywordIdeas.
 *
 * Read-only: it only asks Google for keyword ideas. It changes nothing in the
 * Google Ads account and does not touch the tool's database.
 *
 * Makes 8 requests, one per second, and writes every raw reply to
 * scratch/keyword-ideas-<timestamp>.json. That file holds no credentials and
 * no customer ID, so it is safe to share.
 *
 * Run with: npx tsx scripts/probe-keyword-ideas.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_VERSION = "v25"; // same version the app uses (src/lib/google-ads.ts)
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const GEO_US = "geoTargetConstants/2840";
const LANG_EN = "languageConstants/1000";

type Json = Record<string, unknown>;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) throw new Error(`Missing env var ${key}`);
  return v.trim();
}

let accessToken: string | null = null;
async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`Token refresh failed (HTTP ${res.status}): ${String(json.error ?? "unknown")}`);
  accessToken = String(json.access_token);
  return accessToken;
}

/** One request per 1.1 s, the same spacing the app uses for planning methods. */
let lastCallAt = 0;
async function throttle() {
  const wait = 1100 - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

type Entry = {
  label: string;
  request: Json;
  status: number;
  ms: number;
  /** Reply with the result list cut to the first 5 items (full count kept below). */
  response: Json;
  resultCount: number | null;
  topLevelKeys: string[];
  firstResultKeys: string[];
};
const transcript: Entry[] = [];

async function ideas(label: string, extra: Json): Promise<Json> {
  const body: Json = {
    language: LANG_EN,
    geoTargetConstants: [GEO_US],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    historicalMetricsOptions: { includeAverageCpc: true },
    ...extra,
  };
  await throttle();
  const token = await getAccessToken();
  const started = Date.now();
  const res = await fetch(`${BASE}/customers/${requireEnv("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "")}:generateKeywordIdeas`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
      "login-customer-id": requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const json = (await res.json().catch(() => ({ unparseable: true }))) as Json;
  const results = Array.isArray(json.results) ? (json.results as Json[]) : null;
  const first = results?.[0];
  transcript.push({
    label,
    request: body, // no customer ID, no headers
    status: res.status,
    ms,
    response: results ? { ...json, results: results.slice(0, 5) } : json,
    resultCount: results ? results.length : null,
    topLevelKeys: Object.keys(json),
    firstResultKeys: first ? Object.keys(first) : [],
  });
  const tail = res.ok
    ? `${results ? results.length : 0} ideas, totalSize=${String(json.totalSize ?? "absent")}, nextPageToken=${json.nextPageToken ? "yes" : "no"}`
    : JSON.stringify(json).slice(0, 400);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${label} → HTTP ${res.status} in ${ms} ms — ${tail}`);
  return json;
}

async function main() {
  // 1. One keyword seed, default page size: how many ideas come back at all?
  const a = await ideas("A: one keyword seed, default page size", { keywordSeed: { keywords: ["running shoes"] } });

  // 2. Small page: does paging work, and does the second page differ from the first?
  const b = await ideas("B: one keyword seed, pageSize 50", { keywordSeed: { keywords: ["running shoes"] }, pageSize: 50 });
  if (typeof b.nextPageToken === "string" && b.nextPageToken) {
    await ideas("C: page 2 of B", { keywordSeed: { keywords: ["running shoes"] }, pageSize: 50, pageToken: b.nextPageToken });
  } else {
    console.log("     C skipped: B returned no nextPageToken");
  }

  // 3. Two seeds in one request: is there any field saying which seed produced an idea?
  await ideas("D: two keyword seeds together", { keywordSeed: { keywords: ["running shoes", "garden hose"] }, pageSize: 50 });

  // 4. The other seed types.
  await ideas("E: page URL seed", { urlSeed: { url: "https://en.wikipedia.org/wiki/Running" }, pageSize: 50 });
  await ideas("F: keyword + URL seed", {
    keywordAndUrlSeed: { keywords: ["running shoes"], url: "https://en.wikipedia.org/wiki/Running" },
    pageSize: 50,
  });
  await ideas("G: whole-site seed", { siteSeed: { site: "wikipedia.org" }, pageSize: 50 });

  // 5. Worldwide + any language (both fields left out), as the app does for Worldwide.
  await ideas("H: keyword seed, worldwide, any language", {
    keywordSeed: { keywords: ["running shoes"] },
    pageSize: 50,
    language: undefined,
    geoTargetConstants: undefined,
  });

  void a;
  mkdirSync("scratch", { recursive: true });
  const file = join("scratch", `keyword-ideas-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(transcript, null, 2));
  console.log(`\nRaw replies → ${file}  (no credentials or customer ID inside; send this file back)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
