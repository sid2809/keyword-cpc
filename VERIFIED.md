# Verified facts

Answers to the `VERIFY` list in [PLAN.md](./PLAN.md) §2, tested against the live
API. Nothing here is assumed — every entry names how it was checked and when.

Reproduce with `npm run smoke`. Raw request/response transcripts are written to
`scratch/smoke-<timestamp>.json` (gitignored) so any conclusion below can be
re-checked rather than taken on trust.

**API version in use: `v25`** (current as of 2026-08-21; v23, v24, v25 are the
documented versions). Re-check the sunset dates before bumping.

**Account** (the one in `GOOGLE_ADS_CUSTOMER_ID`; this repo is public, so the ID
is not repeated here): currency **INR**, timezone Asia/Calcutta,
`testAccount: false`, `manager: false`, status ENABLED. Its descriptive name is
"NEW TEST ACCOUNT", but the `test_account` flag is false — it is a real
production account and the data returned is real, not sandbox data.

---

## 0. Refresh token validity — ✅ PASS (2026-08-21)

**Checked with:** `npm run check:token` — a bare `grant_type=refresh_token` POST
to `https://oauth2.googleapis.com/token`.

**Result:** HTTP 200. Access token issued, `expires_in` 3599s, scope
`https://www.googleapis.com/auth/adwords`. The token is valid and correctly
scoped.

**Consent screen mode:** *In production* — confirmed by the user on 2026-08-21
from Google Cloud Console. Not exposed by any API, so it can only be read from
the console. It matters because *Testing*-mode refresh tokens expire 7 days
after issue; because this app is published, the token is long-lived and needs no
periodic re-minting. A future `invalid_grant` would mean manual revocation or a
rotated client secret.

---

## 1. Currency of returned micros — ✅ INR, as expected (2026-08-21)

**Checked with:** `SELECT customer.currency_code FROM customer` via
`GoogleAdsService.search`.

**Result:** `currencyCode: "INR"`.

Micros are returned in the **account's** currency, not the currency of the geo
target — the requests below target US (2840) and still come back in INR. So
divide by 1,000,000 and format as ₹, per PLAN.md §5.

---

## 2. `average_cpc_micros` behaviour — ⚠️ OPT-IN, not returned by default (2026-08-21)

**This corrects an assumption in PLAN.md §2**, which lists `average_cpc_micros`
as a plain response field. It exists, but it is **absent from the response
unless `historical_metrics_options.include_average_cpc` is `true`**.

Identical keyword set, US geo, English, GOOGLE_SEARCH:

| Request | `averageCpcMicros` |
|---|---|
| no `historicalMetricsOptions` | **field absent on every row** |
| `historicalMetricsOptions.includeAverageCpc: true` | populated on every row |

The runner must always send `includeAverageCpc: true` — the whole tool is about
CPC, and forgetting it fails silently with no error, just missing data.

**Units sanity check** (US geo, INR account, `includeAverageCpc: true`):

| keyword | avg CPC | low top-of-page | high top-of-page | avg monthly searches | comp | idx |
|---|---|---|---|---|---|---|
| gardening tools | ₹58.54 | ₹18.92 | ₹112.32 | 60,500 | HIGH | 100 |
| raised garden bed | ₹123.07 | ₹30.00 | ₹227.45 | 165,000 | HIGH | 100 |
| indoor plants | ₹85.29 | ₹10.60 | ₹157.93 | 110,000 | HIGH | 100 |
| lawn mower | ₹85.50 | ₹17.58 | ₹298.98 | 301,000 | HIGH | 100 |
| garden hose | ₹68.83 | ₹17.33 | ₹99.07 | 60,500 | HIGH | 100 |

Magnitudes are plausible (₹58.54 ≈ $0.70 for US "gardening tools"), and avg CPC
sits between the low and high top-of-page bids on every row, as it should.

> **Still to do:** the user should spot-check these five against the Keyword
> Planner UI. The API is self-consistent, but only the UI comparison proves the
> numbers match what Google shows for the same geo/language/network.

**No-data rows:** the keyword is returned with **no `keywordMetrics` key at
all** — not null fields, not zeros:

```json
{ "text": "zqxjkw plimbort gardening" }
```

So `no_data` is `!('keywordMetrics' in result)`. Do not test individual metric
fields for null.

---

## 3. Effect of `year_month_range` — ✅ SERIES ONLY, aggregates never move (2026-08-21)

**The community reports in PLAN.md §2 are correct.** `average_cpc_micros`,
`avg_monthly_searches`, `low_top_of_page_bid_micros` and
`high_top_of_page_bid_micros` are **completely invariant** to
`year_month_range`. Across 16 calls spanning 1-month to 48-month windows,
"gardening tools" returned `averageCpcMicros: 58540700` and
`avgMonthlySearches: 60500` every single time.

`year_month_range` changes **only** the length and span of
`monthly_search_volumes[]`.

**Consequence for the UI (PLAN.md §2 item 3 pre-decided this):** label the
3/6/12-month presets as affecting the **volume series only**. They must not
imply a per-range CPC — there is no such thing in this API.

### Range rules found by probing

| Behaviour | Result |
|---|---|
| Max lookback | **48 months**. `JAN-2020..JUL-2026` silently clamps to `AUG-2022..JUL-2026`. |
| End month = current month | **HTTP 400** `keywordPlanIdeaError: INVALID_VALUE`. The end must be a completed month. |
| Inverted range (end before start) | **HTTP 400** `INVALID_VALUE`. |
| Out-of-range start | Silently clamped, no error. |

Both 400s must be prevented by UI validation rather than surfaced raw.

### ⚠️ The most recent month is eventually-consistent

The newest month appears and disappears between **identical consecutive
requests**. This is reproduced by the stability section of `npm run smoke`.

Run 1 — same four requests, four times, ~1s apart:

```
                          round1  round2  round3  round4
none (no range)            11 mo   12 mo   11 mo   12 mo   ← FLAPPING
AUG2025..JUL2026 (12)      12 mo   12 mo   12 mo   12 mo
NOV2025..JUL2026  (9)       9 mo    9 mo    9 mo    9 mo
OCT2025..JUL2026 (10)      10 mo   10 mo   10 mo   10 mo
```

Run 2 — independent repeat, one keyword, three rounds:

```
                     round1              round2              round3
implicit (no range)  12 mo, last JUN-26  11 mo, last JUN-26  12 mo, last JUL-26   ← 3 shapes
explicit 12-month    12 mo, last JUL-26  12 mo, last JUL-26  12 mo, last JUL-26   ← stable
```

The implicit window produced **three different shapes in three consecutive
calls**, including a 12-month window ending a month earlier. Explicit ranges
were stable in both runs — though earlier in the first session explicit ranges
*also* dropped the newest month (`AUG2025..JUL2026` → 11 months,
`NOV2025..JUL2026` → 8), so explicit is markedly more reliable but not a
guarantee. This looks like JUL-2026 propagating through Google's backend.

**Aggregates never wobbled** — `cpc=58540700 vol=60500` on every one of the
~30 calls across both runs. Only the tail of the monthly series moves.

Three consequences for the build:

1. **Always send an explicit `year_month_range`**, even for the default
   12-month preset. The implicit window was by far the least stable; the
   explicit one held steady in every round of both runs.
2. **Never assume 12 data points.** Render sparklines from whatever comes back,
   keyed by `(year, month)`; pad or leave gaps rather than indexing positionally.
3. **Do not treat a series-length change as a real change** in the Phase 4
   refresh/delta feature — diff on `(year, month)` keys and on aggregates, never
   on array length.

---

## 4. Client library choice — ✅ DIRECT REST (decided with user, 2026-08-21)

| | Opteo `google-ads-api` | Direct REST |
|---|---|---|
| Latest release | 24.1.0, 2026-06-15 | n/a |
| Maintenance | Healthy — 22.0.0 Jan 2026, 23.0.0 Jan 2026, 24.1.0 Jun 2026 | n/a |
| API version | **v24** (one behind current v25) | **v25**, whatever we send |
| Dependencies | ~8 transitive (`google-gax`, `google-ads-node`, `axios`, `grpc`) | none — Node 22 `fetch` |

**Decision: direct REST.** This app calls one endpoint
(`:generateKeywordHistoricalMetrics`) plus an occasional customer query; a
client wrapping 200+ services is not worth the dependency weight or the version
lag. `scripts/smoke-test.ts` already proves the REST path end to end. The cost
is hand-rolling types, throttle and backoff — roughly 150 lines, most of which
the smoke test already contains.

Revisit if v1 ever needs mutations or reporting beyond keyword planning.

---

## 5. Basic-access quota headroom — ✅ ample (2026-08-21)

From the [quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas)
and [access levels](https://developers.google.com/google-ads/api/docs/access-levels) docs:

| | |
|---|---|
| Basic access daily limit | **15,000 operations/day** (test and production alike) |
| `KeywordPlanIdeaService` cost | **1 operation per request**, regardless of keyword count |
| Rate limit | **1 request/second per CID** for `GenerateKeywordHistoricalMetrics` |
| Violation | `RESOURCE_EXHAUSTED` |

**The daily quota is not the binding constraint — the 1 rps rate limit is.**
At the documented 10,000 keywords/request ceiling, 15,000 operations covers far
more keywords per day than this tool will ever submit.

Implication for the Phase 2 chunk-size decision (PLAN.md §3 leaves it open):
since quota is per *request*, not per keyword, smaller chunks cost real
wall-clock (1 rps) and buy only progress granularity. A 100,000-keyword run
takes ~10s at 10k chunks but ~100s at 1k chunks. Suggest chunking at **5,000** —
still fast, but a progress bar that moves more than twice.

---

## 6. Request limits and dedup semantics — ✅ tested (2026-08-21)

Probed directly before building the Phase 2 runner, since chunking and the
submitted→canonical mapping both depend on these.

### 10,000 keywords/request is a hard ceiling

| keywords sent | result |
|---|---|
| 10,000 | HTTP 200, **10,000 rows** returned |
| 10,001 | HTTP 400 `keywordPlanIdeaError: INVALID_VALUE` |
| 20,000 | HTTP 400 `keywordPlanIdeaError: INVALID_VALUE` |

The docs' figure is exact, and the error is a generic `INVALID_VALUE` with no
hint about the count — so the runner must enforce the cap itself rather than
rely on a helpful error.

### Every submitted keyword is accounted for

A 5-keyword request containing a nonsense phrase and a `car`/`cars` pair
returned 4 rows, and **all 5 inputs were recoverable** — each appeared either as
a row's `text` or inside some row's `close_variants[]`. The 10,000 synthetic
no-data keywords likewise came back as 10,000 rows.

So the mapping is total: `submitted → canonical` can be built as
`row.text ∪ row.closeVariants → row.text`, with no submitted keyword left
unexplained. (The runner still marks any unmatched input as no-data rather than
trusting this absolutely.)

### Casing collapses, duplicates are silently ignored

Submitting `["gardening tools", "Gardening Tools", "GARDENING TOOLS",
"gardening tools", "garden hose"]` returned **2 rows**:

```json
{ "text": "gardening tools",
  "closeVariants": ["Gardening Tools", "GARDENING TOOLS", "gardening tools"] }
{ "text": "garden hose" }
```

Three things follow:

1. Case variants collapse into one canonical row — matching the plan's
   "lowercase for canonical comparison, preserve original casing in
   `submitted_text`" decision.
2. `close_variants` includes the input that *became* `text`, so the union above
   is the right way to read it, not a set difference.
3. Duplicate inputs in a single request do **not** error; they are silently
   deduped. The runner still de-duplicates before sending, to avoid wasting
   room under the 10,000 cap.

### Chunk size

Since quota is charged per request and not per keyword (§5), a larger chunk is
strictly cheaper in both quota and wall-clock. The only argument for smaller
chunks is progress granularity, and a 10,000-row response is a large JSON
payload to hold in memory. **Chunking at 5,000** keeps responses reasonable
while making a 20,000-keyword run tick four times instead of twice.

---

## 7. Does `average_cpc_micros` respond to geo? — ✅ YES, strongly (2026-08-21)

**Tested because it was suspected of ignoring geo.** It does not ignore geo.

Same five keywords, same language (English), network (GOOGLE_SEARCH) and range
(Aug 2025 – Jul 2026); only `geo_target_constants` changed. Each geo was queried
twice, interleaved (US, IN, US, IN), so a real difference could be told apart
from run-to-run noise and from ordering effects. The `metrics_cache` was
bypassed entirely — these were direct API calls.

| keyword | `average_cpc_micros` US (2840) | India (2356) | ratio |
|---|---|---|---|
| gardening tools | 58,540,700 (₹58.54) | 3,190,953 (₹3.19) | 18× |
| raised garden bed | 123,066,095 (₹123.07) | 5,738,502 (₹5.74) | 21× |
| indoor plants | 85,288,415 (₹85.29) | 2,876,270 (₹2.88) | 30× |
| lawn mower | 85,502,160 (₹85.50) | 4,982,228 (₹4.98) | 17× |
| garden hose | 68,825,054 (₹68.83) | 3,250,689 (₹3.25) | 21× |

Every value differed; every value was **byte-identical on the repeat call** for
its own geo. Every other field moved with geo too — volume, both top-of-page
bids, and competition index:

| keyword | volume US → IN | low top US → IN | high top US → IN |
|---|---|---|---|
| gardening tools | 60,500 → 27,100 | ₹18.92 → ₹0.77 | ₹112.32 → ₹4.93 |
| raised garden bed | 165,000 → 3,600 | ₹30.00 → ₹1.69 | ₹227.45 → ₹20.01 |
| indoor plants | 110,000 → 165,000 | ₹10.60 → ₹0.77 | ₹157.93 → ₹8.66 |
| lawn mower | 301,000 → 14,800 | ₹17.58 → ₹1.31 | ₹298.98 → ₹10.86 |
| garden hose | 60,500 → 6,600 | ₹17.33 → ₹1.51 | ₹99.07 → ₹8.88 |

**Verdict: there is no geo defect.** Geo targeting works on every field,
including `average_cpc_micros`. Note that the account is INR, and the US figures
are still returned in INR — micros follow the *account's* currency, not the geo's
(§1). Reproduce with `scratch/geo-probe.ts`.

### The actual `average_cpc_micros` anomalies

Two real oddities remain, neither geo-related:

1. **It is opt-in and fails silently** (§2). Without
   `historical_metrics_options.include_average_cpc = true` the field is simply
   absent — no error, no warning, no null. A caller who forgets it gets a
   complete-looking response with no CPC anywhere.
2. **It is completely invariant to `year_month_range`** (§3). Across ~30 calls
   spanning 1-month to 48-month windows it never moved by a single micro. It is
   not a per-period figure, so it cannot be used to show CPC change over time.
   The top-of-page bids share this invariance.

Also worth knowing: `average_cpc_micros` sat strictly inside the
low–high top-of-page band on all ten measurements above, but at no fixed
position within it (its position ranged from 24% to 63% of the way up the band),
so it is not derivable from the band.

---

## 8. Decision: the top-of-page band is the primary metric (2026-08-21)

**Decided with the user on 2026-08-21.** The low–high top-of-page bid band —
specifically **`high_top_of_page_bid_micros`** — is now the primary metric
throughout the app. `average_cpc_micros` is demoted to a secondary,
informational column.

**What this changes:**

| Surface | Now keyed off |
|---|---|
| Heat colouring (CPC cell + bands) | high top-of-page bid |
| Histogram buckets and bar colours | high top-of-page bid |
| Volume-weighted summary figure | high top-of-page bid (with the low bid shown as the band's floor) |
| Median in the summary | high top-of-page bid |
| Runs list / recent-runs headline | high top-of-page bid |
| Min/max filter and histogram click | high top-of-page bid |
| Default table sort (deduped mode) | high top-of-page bid |
| Export default column order | low top, high top, then avg CPC |

Average CPC remains available everywhere — a table column (labelled "Avg CPC
(info)" and rendered muted), a summary tile, and an export column — it simply no
longer drives colour, buckets or the headline number.

**Why this is defensible on its own terms**, independent of the geo question:
the top-of-page bids are what an advertiser actually has to bid to appear at the
top of the page, which is the decision this tool exists to support (repurposing
PMax page feeds). `average_cpc_micros` is a modelled aggregate whose definition
Google does not document in the historical-metrics reference, it has to be
explicitly requested, and it silently disappears when it is not. A band also
carries more information than a point estimate — the low–high spread shows how
contested a keyword is.

**Caveat to keep in mind:** the top-of-page bids are invariant to
`year_month_range` in exactly the same way avg CPC is (§3), so switching the
primary metric does **not** buy any time-sensitivity. Date-range presets still
affect the volume series only.
