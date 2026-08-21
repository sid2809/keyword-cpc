# Keyword CPC Research Tool — Build Plan (v1)

Bulk keyword CPC research tool using the Google Ads API Keyword Planner services.
Purpose: research avg CPC / volume by keyword and niche to decide how to repurpose
PMax page feeds. Single user. Run locally first; deploy to Railway later.

**Ground rule for the implementing agent (Claude Code): DO NOT ASSUME ANYTHING.**
Every item marked `VERIFY` below must be tested against the live API before building
logic on top of it. If something is unknown, say so and ask — never guess silently.

---

## 1. Locked decisions

- Stack: **Next.js** (App Router) + **PostgreSQL**. Local-first (Postgres via Docker
  or local install — ask user which he prefers at setup). Railway deploy later; keep
  config 12-factor (env vars only) so the move is trivial.
- Input: paste keywords OR upload sheet (**CSV and XLSX both**).
- Google Ads API: **basic access**, OAuth credentials already exist (user supplies
  developer token, client ID/secret, refresh token, login customer ID, customer ID
  as env vars — request these from the user at setup, do not invent).
- Geo: **US** (geo target constant 2840) default. Language: ask user whether to pin
  English (constant 1000) or leave unset — do not assume.
- Network: **GOOGLE_SEARCH only** (explicitly set; API default is Search+Partners).
- Currency: account is INR; API returns micros in account currency (confirmed by
  user's prior tools). Display ₹ formatted values; store raw micros.
- Dedup: toggle at top of run setup — "Keep my list intact" (map Google's deduped
  result back to every submitted row) vs "Show deduped only".
- Date range: default last 12 months; presets for shorter ranges (3/6/12 mo).
  See VERIFY #3 before promising per-range CPC.
- Sparklines: 12-month volume series shown per keyword, column toggleable on/off.
- No-data keywords: greyed rows inline, one-click "remove all no-data rows".
- Export: CSV/XLSX with **column selection** before download.
- Run history stored; recent runs cached; user can **save a search forever**;
  runs taggable with niche/site label (e.g. "ponly gardening").
- Run summary: **volume-weighted avg CPC** (primary) + median alongside; CPC
  distribution histogram.
- Filters in results: CPC band (min/max), volume, competition index, text search.
- Single user auth: simple password login (env var) with signed HTTP-only cookie —
  same pattern as user's tracker app. No multi-user.
- AI niche tagging: **DEFERRED** — do not build now, but keep a nullable
  `niche_tag` column on keyword rows and `tag` on runs so it can be added later.

## 2. Verified API facts (do not re-derive; do re-confirm at smoke test)

Source docs (fetch current versions before coding — API versions sunset fast):
- https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics
- https://developers.google.com/google-ads/api/reference/rpc/ (latest version) —
  `KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`
- https://developers.google.com/google-ads/api/docs/best-practices/quotas

Facts:
- Endpoint: `KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`. No keyword
  plan object required — pass `keywords[]` directly.
- Request fields: `customer_id`, `keywords[]` (max **10,000**/request),
  `geo_target_constants[]` (max 10), `language`, `keyword_plan_network`,
  `historical_metrics_options` (incl. `year_month_range`),
  `include_adult_keywords`, `aggregate_metrics`.
- Response per keyword (`KeywordPlanHistoricalMetrics`): `average_cpc_micros`,
  `avg_monthly_searches`, `competition`, `competition_index`,
  `low_top_of_page_bid_micros`, `high_top_of_page_bid_micros`,
  `monthly_search_volumes[]` (month, year, searches).
- Near-exact dedup: "car" and "cars" collapse to one result. The tool must keep a
  submitted→canonical mapping to support "keep my list intact" mode.
- Rate limit: **1 request/second per customer ID** for planning methods (applies
  regardless of access level). Violations → RESOURCE_EXHAUSTED. Build the client
  with a hard 1 rps throttle + exponential backoff retry.
- Data refreshes ~monthly → cache aggressively (see §5 cache table).

### VERIFY at smoke test (Phase 1, before any UI work)
0. Refresh token validity FIRST — user flags it may be expired. Test with a
   bare token-refresh call before anything else. If it fails with
   invalid_grant, walk the user through minting a new refresh token (same
   client ID/secret). Note: if the OAuth consent screen is in "Testing" mode,
   refresh tokens auto-expire after 7 days — check that and recommend
   switching the app to "In production" for a long-lived token.
1. Currency of returned micros under this account is INR as expected.
2. Actual behavior of `average_cpc_micros` (populated for typical keywords? null
   cases?) and units sanity check against Keyword Planner UI for 5 known keywords.
3. Whether `year_month_range` changes CPC/bid aggregates or ONLY the monthly
   volume series (community reports say aggregates may stay fixed at last-12-mo).
   UI copy for date-range presets depends on the answer — if aggregates don't
   change, label presets as affecting volume series only.
4. Client library choice: check current state of Node options (e.g. the Opteo
   `google-ads-api` package — maintenance status, supported API version) vs calling
   the REST endpoint directly with google-auth-library. Pick whichever is healthy
   at build time; REST direct is the safe fallback. Confirm choice with user.
5. Basic-access daily quota headroom for planning methods at user's intended scale.

## 3. Architecture

```
Next.js app (single service)
├── UI (App Router pages, React, Tailwind)
├── API routes (/api/*)
├── Runner: in-process job executor (single user → no external queue needed)
│     - chunks keywords (≤10,000/request; consider smaller chunks like 1–2k for
│       finer progress granularity — decide at build, note tradeoff: more chunks
│       = more requests at 1 rps)
│     - 1 rps throttle, retries with backoff, resumable on failure
│     - writes progress to jobs table; UI polls or uses SSE
└── PostgreSQL
```

- Live mode vs background mode is the SAME runner; the only difference is UX:
  under the threshold the UI stays on-page with a progress bar; over it, the run
  is submitted, appears in a Runs list, and shows the same progress bar there.
- Threshold: default **2,000 keywords** — show it in the UI ("up to 2,000: instant
  mode / more: background mode"). Make it an env var, user may tune.
- Runs must survive a server restart: persist chunk cursor in DB; on boot, resume
  any `running` jobs.

## 4. Database schema (Postgres)

```sql
runs(
  id, created_at, name, tag,            -- tag = niche/site label (manual)
  source ('paste'|'csv'|'xlsx'),
  settings jsonb,                        -- geo, language, network, date range, dedup mode
  status ('queued'|'running'|'done'|'failed'|'canceled'),
  total_keywords int, processed int,     -- progress
  saved_forever boolean default false,
  error text
)

run_keywords(
  id, run_id, submitted_text,            -- exactly what the user gave
  canonical_text,                        -- what Google returned it as (dedup map)
  position int                           -- original row order for intact mode
)

keyword_metrics(                         -- one row per canonical keyword per run
  id, run_id, canonical_text,
  average_cpc_micros bigint,             -- nullable (no-data case)
  avg_monthly_searches bigint,
  competition text, competition_index int,
  low_top_micros bigint, high_top_micros bigint,
  monthly_volumes jsonb,                 -- [{year, month, searches}, ...]
  no_data boolean default false,
  niche_tag text                         -- for future AI tagging; null for now
)

metrics_cache(                           -- cross-run monthly cache
  canonical_text, settings_hash,         -- hash of geo+lang+network+range
  payload jsonb, fetched_at
  -- PK (canonical_text, settings_hash); reuse if fetched_at within same
  -- calendar month; runner checks cache before hitting API
)

jobs(  -- optional; can fold into runs. chunk_cursor int for resume )
```

Retention: keep all runs by default (they're small); `saved_forever=true` exempts
a run from any future cleanup command. Add a manual "delete run" action.

## 5. Design system (locked — implement exactly, tokenized)

All colors live as CSS variables under `[data-theme="light"]` / `[data-theme="dark"]`.
Toggle: sun/moon button in the header; persists to localStorage; first visit
follows `prefers-color-scheme`. No flash-of-wrong-theme (set attr in a tiny
inline head script).

**Day (light):**
- Page bg `#F8FAFC`, surface/cards `#FFFFFF`, borders `#E2E8F0`
- Text `#0F172A` primary / `#64748B` secondary / `#94A3B8` muted
- Accent `#4F46E5` (hover `#4338CA`), accent-soft bg `#EEF2FF`
- Heat: green `#15803D`, amber `#B45309`, red `#B91C1C`

**Night (dark):**
- Page bg `#0B1220`, surface `#131E30`, raised `#1E293B`, borders `#26344A`
- Text `#E2E8F0` / `#94A3B8` / `#64748B`
- Accent `#818CF8` (hover `#A5B4FC`), accent-soft `rgba(129,140,248,.12)`
- Heat: green `#4ADE80`, amber `#FBBF24`, red `#F87171`

**Heat coloring rule:** CPC cells + histogram bars colored by band. Default
bands = run tertiles (cheap/mid/expensive relative to this run) with a small
legend; user-defined absolute ₹ bands override via the filter panel.

**Typography:** Inter for UI (400/500/600 only). ALL numeric columns use a
monospace stack (`ui-monospace, 'JetBrains Mono', monospace`) at 13px with
tabular alignment so ₹ columns line up. ₹ format: `₹1,234.56` (Indian digit
grouping via Intl.NumberFormat('en-IN')).

**Feel:** 4px spacing grid; radius 8px (controls) / 12px (cards); 0.5–1px
borders, no heavy shadows; 150ms ease transitions on hover/theme; visible
`:focus-visible` rings; sticky table header on scroll; row hover highlight;
skeleton loaders while fetching; friendly empty states ("Paste keywords to
start — up to 10,000 per request"); toast errors with retry. Contrast must
pass AA in both themes. Flat design — no gradients.

## 6. Screens

**1. New Search (home) — two-panel workbench layout (locked)**
- Header (all pages): app name left; right side: theme toggle (sun/moon),
  Runs, Settings
- LEFT PANEL (~60%): tabs Paste | Upload.
  - Paste: large textarea (one keyword per line; also accept comma-separated —
    normalize: trim, collapse whitespace, drop empties, lowercase for canonical
    comparison but preserve original casing in submitted_text). Live keyword
    count + threshold notice beneath ("Up to 2,000 runs instantly; larger runs
    go to background — you'll see progress either way").
  - Upload: drag-drop CSV/XLSX → column picker ("which column has keywords?")
    → preview first 10 rows
- RIGHT PANEL (~40%, card): all settings visible at once — geo (default US,
  editable), language, network (default Google Search), date range preset,
  dedup toggle (Keep intact / Deduped), run name, tag. Sensible defaults
  pre-filled so a new user can ignore this panel entirely. "Run search"
  primary button pinned at the card's bottom.
- Panels stack vertically on narrow screens (<900px).
- Below the workbench: "Recent runs" strip (last 5: name, tag, status,
  wtd-avg CPC, click-through to results).
- Submit → progress bar (n of N keywords, ETA from 1 rps math)

**2. Results (per run)**
- Summary header: keyword count, no-data count, volume-weighted avg CPC (₹),
  median CPC, total monthly volume; CPC distribution histogram (bucket keywords
  into ₹ bands; clicking a bar filters the table)
- Table: keyword, avg CPC ₹, low/high top-of-page ₹, avg monthly searches,
  competition index, 12-mo volume sparkline (toggleable column)
- Filters: CPC min–max, volume min, competition, text search
- Greyed no-data rows + "remove no-data rows" one-click
- Column visibility controls; Export button → column-selection modal → CSV/XLSX
  (in intact mode, export includes the user's original rows/order with metrics
  merged; XLSX export of an uploaded sheet preserves the user's other columns)
- "Save forever" star; Refresh action → re-pulls via cache rules and shows
  per-keyword delta vs previous pull (CPC ↑/↓ with amount)

**3. Runs / History**
- List with status, progress bars for running jobs, tags, saved-forever filter
- Compare entry point (nice-to-have, Phase 5): pick 2 runs → delta table

**4. Settings**
- Threshold value, default geo/language, credential health check button
  ("test API connection" → runs a 3-keyword probe, reports currency + sample CPC)

UI quality bar: clean, fast, keyboard-friendly, obvious empty states, INR
formatted as ₹1,234.56 (micros ÷ 1,000,000, 2 decimals). No clutter.

## 7. Build phases (each ends runnable + tested)

- **Phase 0 — Skeleton**: Next.js + Postgres + login + env plumbing. Ask user for
  all Google Ads env vars; document them in README.
- **Phase 1 — API smoke test**: standalone script hitting
  GenerateKeywordHistoricalMetrics with ~5 known keywords. Execute the VERIFY
  list in §2 with the user; record answers in a VERIFIED.md file. **Do not
  proceed until this passes.**
- **Phase 2 — Runner + storage**: chunking, throttle, cache, dedup mapping,
  resume-on-restart. CLI-triggerable for testing.
- **Phase 3 — New Search + Results**: implement the §5 design system (tokens +
  theme toggle) FIRST, then paste flow, then CSV/XLSX upload with column
  picker. Progress bar (polling is fine), full results table + filters +
  histogram + export. Build to the §6 workbench layout exactly.
- **Phase 4 — History, saved searches, refresh + delta, settings screen.**
- **Phase 5 — Polish**: compare runs, sparkline toggle persistence, empty/error
  states, README with Railway deploy notes.

## 8. Env vars

```
DATABASE_URL
APP_PASSWORD                  # login
SESSION_SECRET                # cookie signing
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_LOGIN_CUSTOMER_ID  # MCC, if querying via manager
GOOGLE_ADS_CUSTOMER_ID        # account to query under
LIVE_MODE_THRESHOLD=2000
```

## 9. Out of scope for v1 (parked)

- AI niche tagging (schema is ready for it)
- Multi-user, multi-geo comparison in one run, Microsoft Ads
- Railway deployment (README notes only)
