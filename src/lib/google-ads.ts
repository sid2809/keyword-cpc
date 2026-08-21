import "server-only";
import { env } from "./env";
import type { RunSettings } from "./run-settings";
import { yearMonthRange } from "./run-settings";

/**
 * Minimal Google Ads REST client — just the two calls this tool makes.
 *
 * Direct REST rather than a client library, decided at VERIFY 4 (see
 * VERIFIED.md §4): the app touches one endpoint, and the Opteo package lags the
 * current API version while pulling in ~8 transitive dependencies.
 *
 * Everything here is informed by VERIFIED.md — in particular:
 *   - `include_average_cpc` MUST be sent or the CPC field is silently absent
 *   - an explicit `year_month_range` is materially more stable than the default
 *   - 10,000 keywords per request is a hard cap, enforced here
 *   - planning methods allow 1 request/second/CID
 */

export const API_VERSION = "v25";
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

/** Hard ceiling proven in VERIFIED.md §6; 10,001 is rejected with INVALID_VALUE. */
export const MAX_KEYWORDS_PER_REQUEST = 10_000;

/** Planning methods: 1 request/second/CID. A little padding avoids edge rejections. */
const MIN_REQUEST_INTERVAL_MS = 1_100;

// --- response shapes --------------------------------------------------------

export type MonthlyVolume = {
  year: number;
  /** 1-12 */
  month: number;
  searches: number;
};

export type KeywordMetrics = {
  averageCpcMicros: number | null;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  monthlyVolumes: MonthlyVolume[];
};

export type HistoricalResult = {
  /** Google's canonical form of the keyword. */
  text: string;
  /**
   * Every submitted input that collapsed into this row, including the one that
   * became `text` (VERIFIED.md §6). Empty when nothing collapsed.
   */
  closeVariants: string[];
  /**
   * True when the API returned no `keywordMetrics` object at all. That is the
   * only reliable no-data signal — the fields are absent, not null.
   */
  noData: boolean;
  metrics: KeywordMetrics | null;
};

// --- raw API JSON -----------------------------------------------------------

type RawMonthly = { year?: string; month?: string; monthlySearches?: string };
type RawMetrics = {
  averageCpcMicros?: string;
  avgMonthlySearches?: string;
  competition?: string;
  competitionIndex?: string;
  lowTopOfPageBidMicros?: string;
  highTopOfPageBidMicros?: string;
  monthlySearchVolumes?: RawMonthly[];
};
type RawResult = { text?: string; closeVariants?: string[]; keywordMetrics?: RawMetrics };
type RawResponse = { results?: RawResult[] };

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function num(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --- auth -------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;
/** In-flight refresh, so N concurrent callers trigger one token request, not N. */
let refreshInFlight: Promise<string> | null = null;

function tokenIsFresh(): boolean {
  // Refresh a minute early so a token never expires mid-flight.
  return cachedToken !== null && Date.now() < cachedToken.expiresAt - 60_000;
}

async function getAccessToken(): Promise<string> {
  if (tokenIsFresh()) return cachedToken!.value;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshAccessToken(): Promise<string> {
  const creds = env.googleAds;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };

  if (!res.ok || !json.access_token) {
    const hint =
      json.error === "invalid_grant"
        ? " The refresh token is expired or revoked — run `npm run check:token`."
        : "";
    throw new GoogleAdsError(
      `OAuth token refresh failed: ${json.error ?? res.status} ${json.error_description ?? ""}.${hint}`,
      { retryable: false, status: res.status },
    );
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

// --- throttle ---------------------------------------------------------------

/**
 * Serialises every planning request through a single promise chain so that
 * concurrent callers cannot exceed 1 rps. Stashed on globalThis because Next's
 * dev server re-evaluates modules on hot reload, and two throttles would defeat
 * the point.
 */
const globalForThrottle = globalThis as unknown as { __kcpcThrottle?: { chain: Promise<void>; lastAt: number } };

function throttleState() {
  if (!globalForThrottle.__kcpcThrottle) {
    globalForThrottle.__kcpcThrottle = { chain: Promise.resolve(), lastAt: 0 };
  }
  return globalForThrottle.__kcpcThrottle;
}

function acquireSlot(): Promise<void> {
  const state = throttleState();
  const slot = state.chain.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - state.lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    state.lastAt = Date.now();
  });
  // Keep the chain alive even if a caller rejects downstream.
  state.chain = slot.catch(() => {});
  return slot;
}

// --- errors -----------------------------------------------------------------

export class GoogleAdsError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly errorCode?: string;

  constructor(message: string, opts: { retryable: boolean; status?: number; errorCode?: string }) {
    super(message);
    this.name = "GoogleAdsError";
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.errorCode = opts.errorCode;
  }
}

type RawError = {
  error?: {
    message?: string;
    status?: string;
    details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[];
  };
};

function describeError(status: number, body: RawError): GoogleAdsError {
  const first = body?.error?.details?.[0]?.errors?.[0];
  const code = first?.errorCode ? Object.values(first.errorCode)[0] : undefined;
  const message = first?.message ?? body?.error?.message ?? `HTTP ${status}`;

  // 429 and 5xx are worth retrying; RESOURCE_EXHAUSTED means we out-ran 1 rps.
  const retryable =
    status === 429 ||
    status >= 500 ||
    body?.error?.status === "RESOURCE_EXHAUSTED" ||
    body?.error?.status === "UNAVAILABLE" ||
    body?.error?.status === "INTERNAL";

  return new GoogleAdsError(`${code ?? body?.error?.status ?? status}: ${message}`, {
    retryable,
    status,
    errorCode: code,
  });
}

// --- request ----------------------------------------------------------------

const MAX_ATTEMPTS = 5;

async function post<T>(path: string, body: unknown): Promise<T> {
  const creds = env.googleAds;
  let lastError: unknown;

  // Serialise the body once, outside the retry loop — for a 10,000-keyword
  // request this is not free, and it must not happen inside a rate-limit slot.
  const payload = JSON.stringify(body);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Get the token BEFORE taking a slot. A cold-start refresh is a network
    // round-trip; doing it after acquiring the slot delays the request by that
    // much and lets the real request rate drift above 1 rps — measured at
    // 895ms between requests, which is exactly what earns RESOURCE_EXHAUSTED.
    const token = await getAccessToken();

    await acquireSlot();

    let res: Response;
    try {
      res = await fetch(`${BASE}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "developer-token": creds.developerToken,
          "login-customer-id": creds.loginCustomerId,
          "Content-Type": "application/json",
        },
        body: payload,
      });
    } catch (err) {
      // Network-level failure — always worth another go.
      lastError = new GoogleAdsError(
        `Network error calling Google Ads: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: true },
      );
      if (attempt === MAX_ATTEMPTS) break;
      await backoff(attempt);
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    const parsed = (await res.json().catch(() => ({}))) as RawError;
    const error = describeError(res.status, parsed);

    // A 401 usually means the cached token went stale; drop it and retry once.
    if (res.status === 401 && attempt < MAX_ATTEMPTS) {
      cachedToken = null;
      lastError = error;
      await backoff(attempt);
      continue;
    }

    if (!error.retryable || attempt === MAX_ATTEMPTS) throw error;
    lastError = error;
    await backoff(attempt);
  }

  throw lastError instanceof Error
    ? lastError
    : new GoogleAdsError("Google Ads request failed", { retryable: false });
}

/** 2s, 4s, 8s, 16s with jitter, so parallel retries don't resynchronise. */
async function backoff(attempt: number) {
  const base = 1000 * 2 ** attempt;
  const jitter = Math.random() * 500;
  await new Promise((r) => setTimeout(r, base + jitter));
}

// --- public API -------------------------------------------------------------

/**
 * Fetches historical metrics for up to MAX_KEYWORDS_PER_REQUEST keywords.
 * Callers are expected to chunk; this throws rather than truncating silently.
 */
export async function generateKeywordHistoricalMetrics(
  keywords: string[],
  settings: RunSettings,
): Promise<HistoricalResult[]> {
  if (keywords.length === 0) return [];
  if (keywords.length > MAX_KEYWORDS_PER_REQUEST) {
    throw new GoogleAdsError(
      `${keywords.length} keywords exceeds the ${MAX_KEYWORDS_PER_REQUEST} per-request cap — chunk before calling.`,
      { retryable: false },
    );
  }

  const range = yearMonthRange(settings.monthsBack);
  const body: Record<string, unknown> = {
    keywords,
    geoTargetConstants: settings.geoTargetConstants,
    keywordPlanNetwork: settings.network,
    includeAdultKeywords: settings.includeAdultKeywords,
    historicalMetricsOptions: {
      // Without this the CPC field is absent — no error, no warning.
      includeAverageCpc: true,
      // Explicit range: materially more stable than the default (VERIFIED.md §3).
      yearMonthRange: {
        start: { year: range.start.year, month: MONTH_NAMES[range.start.month - 1] },
        end: { year: range.end.year, month: MONTH_NAMES[range.end.month - 1] },
      },
    },
  };
  if (settings.language) body.language = settings.language;

  const json = await post<RawResponse>(
    `customers/${env.googleAds.customerId}:generateKeywordHistoricalMetrics`,
    body,
  );

  return (json.results ?? []).map(toResult);
}

function toResult(raw: RawResult): HistoricalResult {
  const m = raw.keywordMetrics;
  // No `keywordMetrics` key at all is the no-data signal (VERIFIED.md §2).
  if (!m) {
    return { text: raw.text ?? "", closeVariants: raw.closeVariants ?? [], noData: true, metrics: null };
  }

  return {
    text: raw.text ?? "",
    closeVariants: raw.closeVariants ?? [],
    noData: false,
    metrics: {
      averageCpcMicros: num(m.averageCpcMicros),
      avgMonthlySearches: num(m.avgMonthlySearches),
      competition: m.competition ?? null,
      competitionIndex: num(m.competitionIndex),
      lowTopOfPageBidMicros: num(m.lowTopOfPageBidMicros),
      highTopOfPageBidMicros: num(m.highTopOfPageBidMicros),
      monthlyVolumes: (m.monthlySearchVolumes ?? [])
        .map((v) => ({
          year: Number(v.year),
          month: MONTH_NAMES.indexOf(v.month ?? "") + 1,
          searches: Number(v.monthlySearches ?? 0),
        }))
        .filter((v) => Number.isFinite(v.year) && v.month >= 1)
        // The API returns these in order, but the series is the one thing that
        // moves between calls, so sort defensively.
        .sort((a, b) => a.year - b.year || a.month - b.month),
    },
  };
}

/** Account metadata, for the Settings-screen connection test. */
export async function getAccountInfo(): Promise<{
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  testAccount: boolean | null;
}> {
  type SearchResponse = {
    results?: { customer?: { descriptiveName?: string; currencyCode?: string; timeZone?: string; testAccount?: boolean } }[];
  };
  const json = await post<SearchResponse>(`customers/${env.googleAds.customerId}/googleAds:search`, {
    query:
      "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.test_account FROM customer LIMIT 1",
  });
  const c = json.results?.[0]?.customer;
  return {
    descriptiveName: c?.descriptiveName ?? null,
    currencyCode: c?.currencyCode ?? null,
    timeZone: c?.timeZone ?? null,
    testAccount: c?.testAccount ?? null,
  };
}
