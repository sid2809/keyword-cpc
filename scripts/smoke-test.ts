/**
 * PLAN.md §7 Phase 1 — Google Ads API smoke test.
 *
 * Answers VERIFY items 1, 2, 3 and 5 from PLAN.md §2 empirically, against the
 * live API, and dumps every raw response to scratch/smoke-<timestamp>.json so
 * the conclusions can be re-checked rather than taken on trust.
 *
 * Deliberately uses the REST endpoint with google-auth-library-free manual
 * token refresh, i.e. no client library, so that VERIFY 4 (library choice)
 * stays an open decision rather than being settled by this script.
 *
 * Run with: npm run smoke
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_VERSION = "v25"; // current as of 2026-08; check sunset dates before bumping
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

const GEO_US = "geoTargetConstants/2840";
const LANG_EN = "languageConstants/1000";

/** Five keywords for the units sanity check against the Keyword Planner UI. */
const SAMPLE_KEYWORDS = [
  "gardening tools",
  "raised garden bed",
  "indoor plants",
  "lawn mower",
  "garden hose",
];

/** Near-exact dedup probe — PLAN.md §2 claims these collapse to one result. */
const DEDUP_PROBE = ["car", "cars"];

/** Should return no data, to capture the shape of a no-data row. */
const NO_DATA_PROBE = ["zqxjkw plimbort gardening", "gardening tools"];

// --- plumbing ---------------------------------------------------------------

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
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  accessToken = String(json.access_token);
  return accessToken;
}

/**
 * Planning methods are limited to 1 request/second per customer ID regardless
 * of access level (PLAN.md §2). Every call goes through this gate.
 */
let lastCallAt = 0;
async function throttle() {
  const wait = 1000 - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

const transcript: { label: string; request: unknown; status: number; response: unknown }[] = [];

async function callApi(label: string, path: string, body: Json): Promise<Json> {
  await throttle();
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
      "login-customer-id": requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Json;
  transcript.push({ label, request: { path, body }, status: res.status, response: json });
  if (!res.ok) {
    console.error(`\n  ✗ ${label} → HTTP ${res.status}`);
    console.error(`    ${JSON.stringify(json).slice(0, 900)}`);
  }
  return json;
}

// --- request builders -------------------------------------------------------

function customerId(): string {
  return requireEnv("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "");
}

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
] as const;

/**
 * Inclusive year_month_range ending at the last COMPLETE month. Google has no
 * data for the current, in-progress month.
 */
function monthRange(monthsBack: number) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (monthsBack - 1), 1));
  return {
    start: { year: start.getUTCFullYear(), month: MONTHS[start.getUTCMonth()] },
    end: { year: end.getUTCFullYear(), month: MONTHS[end.getUTCMonth()] },
  };
}

type MetricsOpts = { includeAverageCpc?: boolean; monthsBack?: number };

function historicalRequest(keywords: string[], opts: MetricsOpts = {}): Json {
  const historicalMetricsOptions: Json = {};
  if (opts.includeAverageCpc !== undefined) {
    historicalMetricsOptions.includeAverageCpc = opts.includeAverageCpc;
  }
  if (opts.monthsBack !== undefined) {
    historicalMetricsOptions.yearMonthRange = monthRange(opts.monthsBack);
  }

  const body: Json = {
    keywords,
    geoTargetConstants: [GEO_US],
    language: LANG_EN,
    keywordPlanNetwork: "GOOGLE_SEARCH", // explicit; API default is Search+Partners
    includeAdultKeywords: false,
  };
  if (Object.keys(historicalMetricsOptions).length > 0) {
    body.historicalMetricsOptions = historicalMetricsOptions;
  }
  return body;
}

async function historicalMetrics(label: string, keywords: string[], opts: MetricsOpts = {}) {
  console.log(`\n▸ ${label}`);
  return callApi(
    label,
    `customers/${customerId()}:generateKeywordHistoricalMetrics`,
    historicalRequest(keywords, opts),
  );
}

// --- reporting helpers ------------------------------------------------------

type ResultRow = {
  text?: string;
  keywordMetrics?: {
    avgMonthlySearches?: string;
    competition?: string;
    competitionIndex?: string;
    averageCpcMicros?: string;
    lowTopOfPageBidMicros?: string;
    highTopOfPageBidMicros?: string;
    monthlySearchVolumes?: { year?: string; month?: string; monthlySearches?: string }[];
  };
  closeVariants?: string[];
};

function rows(res: Json): ResultRow[] {
  return (res.results as ResultRow[] | undefined) ?? [];
}

function micros(v: string | undefined): string {
  if (v === undefined) return "—";
  return (Number(v) / 1_000_000).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function printRows(res: Json) {
  const list = rows(res);
  if (list.length === 0) {
    console.log("  (no results)");
    return;
  }
  console.log(
    `  ${"keyword".padEnd(22)} ${"avgCpc".padStart(10)} ${"lowTop".padStart(10)} ${"highTop".padStart(10)} ${"volume".padStart(9)}  comp  idx  months`,
  );
  for (const r of list) {
    const m = r.keywordMetrics;
    console.log(
      `  ${(r.text ?? "?").padEnd(22)} ` +
        `${micros(m?.averageCpcMicros).padStart(10)} ` +
        `${micros(m?.lowTopOfPageBidMicros).padStart(10)} ` +
        `${micros(m?.highTopOfPageBidMicros).padStart(10)} ` +
        `${(m?.avgMonthlySearches ?? "—").padStart(9)}  ` +
        `${(m?.competition ?? "—").slice(0, 4).padEnd(4)}  ` +
        `${(m?.competitionIndex ?? "—").padStart(3)}  ` +
        `${m?.monthlySearchVolumes?.length ?? 0}`,
    );
    if (r.closeVariants?.length) {
      console.log(`      closeVariants: ${JSON.stringify(r.closeVariants)}`);
    }
  }
}

function keyedMetrics(res: Json) {
  const out = new Map<string, ResultRow["keywordMetrics"]>();
  for (const r of rows(res)) if (r.text) out.set(r.text, r.keywordMetrics);
  return out;
}

// --- the tests --------------------------------------------------------------

async function main() {
  console.log(`Google Ads API smoke test — ${API_VERSION}`);
  console.log(`customer ${customerId()} via manager ${requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID")}`);

  // VERIFY 1 — account currency. Authoritative source is the customer record.
  console.log("\n=== VERIFY 1: account currency ===");
  await throttle();
  const token = await getAccessToken();
  const searchRes = await fetch(`${BASE}/customers/${customerId()}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
      "login-customer-id": requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
    }),
  });
  const searchJson = (await searchRes.json()) as Json;
  transcript.push({ label: "customer currency", request: "SELECT customer...", status: searchRes.status, response: searchJson });
  if (searchRes.ok) {
    const c = (searchJson.results as { customer?: Json }[] | undefined)?.[0]?.customer;
    console.log(`  name:     ${c?.descriptiveName}`);
    console.log(`  currency: ${c?.currencyCode}`);
    console.log(`  timezone: ${c?.timeZone}`);
  } else {
    console.error(`  ✗ HTTP ${searchRes.status}: ${JSON.stringify(searchJson).slice(0, 700)}`);
  }

  // VERIFY 2 — is average_cpc_micros returned by default, or opt-in?
  console.log("\n=== VERIFY 2: average_cpc_micros behaviour ===");
  const baseline = await historicalMetrics("A: no historicalMetricsOptions", SAMPLE_KEYWORDS);
  printRows(baseline);

  const withCpc = await historicalMetrics("B: includeAverageCpc=true", SAMPLE_KEYWORDS, {
    includeAverageCpc: true,
  });
  printRows(withCpc);

  // VERIFY 3 — does year_month_range move the aggregates, or only the series?
  console.log("\n=== VERIFY 3: effect of year_month_range ===");
  const r12 = await historicalMetrics("C: includeAverageCpc + last 12 months", SAMPLE_KEYWORDS, {
    includeAverageCpc: true,
    monthsBack: 12,
  });
  printRows(r12);

  const r3 = await historicalMetrics("D: includeAverageCpc + last 3 months", SAMPLE_KEYWORDS, {
    includeAverageCpc: true,
    monthsBack: 3,
  });
  printRows(r3);

  const a = keyedMetrics(r12);
  const b = keyedMetrics(r3);
  console.log("\n  12-month vs 3-month comparison:");
  let aggregatesMoved = false;
  let seriesMoved = false;
  for (const [kw, m12] of a) {
    const m3 = b.get(kw);
    if (!m3) continue;
    const sameCpc = m12?.averageCpcMicros === m3.averageCpcMicros;
    const sameVol = m12?.avgMonthlySearches === m3.avgMonthlySearches;
    const sameLow = m12?.lowTopOfPageBidMicros === m3.lowTopOfPageBidMicros;
    const len12 = m12?.monthlySearchVolumes?.length ?? 0;
    const len3 = m3.monthlySearchVolumes?.length ?? 0;
    if (!sameCpc || !sameVol || !sameLow) aggregatesMoved = true;
    if (len12 !== len3) seriesMoved = true;
    console.log(
      `    ${kw.padEnd(22)} avgCpc ${sameCpc ? "same" : "DIFFERENT"}  ` +
        `avgVol ${sameVol ? "same" : "DIFFERENT"}  ` +
        `lowTop ${sameLow ? "same" : "DIFFERENT"}  ` +
        `series ${len12} → ${len3}`,
    );
  }
  console.log(
    `\n  → aggregates ${aggregatesMoved ? "DO change" : "do NOT change"} with year_month_range`,
  );
  console.log(`  → monthly series ${seriesMoved ? "DOES change" : "does NOT change"} length`);

  // Near-exact dedup and the no-data row shape.
  console.log("\n=== dedup probe: 'car' vs 'cars' ===");
  const dedup = await historicalMetrics("E: dedup probe", DEDUP_PROBE, { includeAverageCpc: true });
  console.log(`  submitted ${DEDUP_PROBE.length}, returned ${rows(dedup).length}`);
  printRows(dedup);

  console.log("\n=== no-data probe ===");
  const noData = await historicalMetrics("F: no-data probe", NO_DATA_PROBE, {
    includeAverageCpc: true,
  });
  console.log(`  submitted ${NO_DATA_PROBE.length}, returned ${rows(noData).length}`);
  printRows(noData);
  console.log(`  raw: ${JSON.stringify(noData).slice(0, 600)}`);

  // VERIFY 3 (cont.) — range validation rules the UI has to enforce.
  console.log("\n=== range edge cases ===");
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = MONTHS[now.getUTCMonth()];

  const edge = async (label: string, range: Json) => {
    await throttle();
    const body = historicalRequest(["gardening tools"], { includeAverageCpc: true });
    body.historicalMetricsOptions = { includeAverageCpc: true, yearMonthRange: range };
    const token2 = await getAccessToken();
    const res = await fetch(`${BASE}/customers/${customerId()}:generateKeywordHistoricalMetrics`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token2}`,
        "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
        "login-customer-id": requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as Json;
    transcript.push({ label: `edge: ${label}`, request: range, status: res.status, response: j });
    if (!res.ok) {
      const errObj = j.error as { details?: { errors?: { errorCode?: Json; message?: string }[] }[] } | undefined;
      const e = errObj?.details?.[0]?.errors?.[0];
      console.log(`  ${label.padEnd(30)} HTTP ${res.status}  ${JSON.stringify(e?.errorCode ?? j).slice(0, 90)}`);
      return;
    }
    const v = rows(j)[0]?.keywordMetrics?.monthlySearchVolumes ?? [];
    console.log(
      `  ${label.padEnd(30)} ${String(v.length).padStart(2)} mo  ` +
        (v.length ? `${v[0].month?.slice(0, 3)}-${v[0].year} .. ${v[v.length - 1].month?.slice(0, 3)}-${v[v.length - 1].year}` : "—"),
    );
  };

  await edge("end = current month", {
    start: { year: curYear, month: curMonth },
    end: { year: curYear, month: curMonth },
  });
  await edge("inverted (end < start)", {
    start: { year: curYear, month: MONTHS[6] },
    end: { year: curYear, month: MONTHS[4] },
  });
  await edge("6 years back (clamp probe)", {
    ...monthRange(12),
    start: { year: curYear - 6, month: "JANUARY" },
  });

  // VERIFY 3 (cont.) — is the newest month stable between identical requests?
  console.log("\n=== stability of the newest month (identical requests) ===");
  const ROUNDS = 3;
  const sigs = { implicit: new Set<string>(), explicit: new Set<string>() };
  const aggSigs = new Set<string>();
  for (let i = 1; i <= ROUNDS; i++) {
    const imp = await historicalMetrics(`stability ${i}: implicit range`, ["gardening tools"], {
      includeAverageCpc: true,
    });
    const exp = await historicalMetrics(`stability ${i}: explicit 12mo`, ["gardening tools"], {
      includeAverageCpc: true,
      monthsBack: 12,
    });
    const sig = (r: Json) => {
      const m = rows(r)[0]?.keywordMetrics;
      const v = m?.monthlySearchVolumes ?? [];
      return `${v.length}mo/last=${v.length ? `${v[v.length - 1].month?.slice(0, 3)}-${v[v.length - 1].year}` : "—"}`;
    };
    const agg = (r: Json) => {
      const m = rows(r)[0]?.keywordMetrics;
      return `cpc=${m?.averageCpcMicros} vol=${m?.avgMonthlySearches}`;
    };
    sigs.implicit.add(sig(imp));
    sigs.explicit.add(sig(exp));
    aggSigs.add(agg(imp));
    aggSigs.add(agg(exp));
    console.log(`  round ${i}: implicit ${sig(imp)}   explicit ${sig(exp)}   ${agg(exp)}`);
  }
  console.log(
    `\n  implicit range: ${sigs.implicit.size === 1 ? "stable" : "FLAPPING"} — ${[...sigs.implicit].join(" | ")}`,
  );
  console.log(
    `  explicit range: ${sigs.explicit.size === 1 ? "stable" : "FLAPPING"} — ${[...sigs.explicit].join(" | ")}`,
  );
  console.log(
    `  aggregates:     ${aggSigs.size === 1 ? "stable across every call" : "FLAPPING"} — ${[...aggSigs].join(" | ")}`,
  );
  if (sigs.implicit.size > 1 || sigs.explicit.size > 1) {
    console.log("  → the newest month is eventually-consistent; never assume a fixed series length.");
  }

  // Save everything for re-checking.
  const dir = join(process.cwd(), "scratch");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `smoke-${stamp}.json`);
  writeFileSync(file, JSON.stringify(transcript, null, 2));
  console.log(`\nRaw transcript → ${file}`);

  // These two edge cases are *expected* to 400 — that is the finding, not a failure.
  const EXPECTED_400 = ["edge: end = current month", "edge: inverted (end < start)"];
  const unexpected = transcript.filter((t) => t.status >= 400 && !EXPECTED_400.includes(t.label));
  const expectedMissing = EXPECTED_400.filter(
    (label) => !transcript.some((t) => t.label === label && t.status >= 400),
  );

  if (expectedMissing.length > 0) {
    console.error(
      `\nExpected a 400 from: ${expectedMissing.join(", ")} — the API's validation rules may have changed. Re-check VERIFIED.md §3.`,
    );
  }
  if (unexpected.length > 0) {
    console.error(`\n${unexpected.length} call(s) failed: ${unexpected.map((f) => f.label).join(", ")}`);
    process.exit(1);
  }
  if (expectedMissing.length > 0) process.exit(1);

  console.log("\nAll calls behaved as VERIFIED.md describes.");
}

main().catch((err) => {
  console.error("\nSmoke test threw:", err instanceof Error ? err.message : err);
  process.exit(1);
});
