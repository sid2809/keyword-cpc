# Keyword CPC

Bulk keyword CPC and search-volume research using the Google Ads
`KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics` endpoint. Single user,
local-first, Railway-deployable later.

Build plan and locked decisions live in [PLAN.md](./PLAN.md). API behaviour that
was tested against the live endpoint — including three things the plan got wrong
— is recorded in [VERIFIED.md](./VERIFIED.md).

**Status: all five build phases complete.** Paste or upload keywords, watch
progress, filter and chart the results, export them, save runs forever, re-pull
them to see what moved, compare two runs side by side, and edit the defaults.

## Stack

| | |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) + React 19 |
| Styling | Tailwind CSS v4, design tokens per PLAN.md §5 |
| Database | PostgreSQL 16 (`pg`, no ORM) |
| Spreadsheets | `papaparse` (CSV), `read-excel-file` / `write-excel-file` (XLSX) |
| Auth | Single password + HMAC-signed HTTP-only cookie |

> Next.js 16 renamed the `middleware.ts` convention to **`proxy.ts`**. The auth
> guard lives at `src/proxy.ts`.

## Setup

### 1. Postgres

Local install via Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb keyword_cpc
```

`psql` is not on `PATH` by default; add
`/opt/homebrew/opt/postgresql@16/bin` if you want the CLI.

### 2. Environment

```bash
cp .env.example .env
```

Fill in every value — see the comments in `.env.example` for where each one
comes from. `.env` is gitignored; `.env.example` is not.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `APP_PASSWORD` | Password for the login screen |
| `SESSION_SECRET` | HMAC key for the session cookie (`openssl rand -base64 36`) |
| `LIVE_MODE_THRESHOLD` | Keywords at or below this run on-page; above it, in the background. Default `2000` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | From the manager account's API Center |
| `GOOGLE_ADS_CLIENT_ID` / `_SECRET` | OAuth client from Google Cloud Console |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token with the `adwords` scope |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager (MCC) account, digits only |
| `GOOGLE_ADS_CUSTOMER_ID` | Account the data is queried under, digits only |

### 3. Migrate and run

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending `db/migrations/*.sql`, each in a transaction |
| `npm run check:token` | PLAN.md §2 VERIFY 0 — confirm the Google refresh token still works |
| `npm run smoke` | Phase 1 API smoke test; re-verifies every claim in VERIFIED.md |
| `npm run run:keywords` | Drive the runner from the CLI (see below) |
| `npm run scan:secrets` | gitleaks over the staged diff (what the pre-commit hook runs) |
| `npm run scan:secrets:all` | gitleaks over the full history |

## Secret scanning

**This repository is public.** A committed credential is public the moment it is
pushed, so commits are gated by a [gitleaks](https://github.com/gitleaks/gitleaks)
pre-commit hook.

```bash
brew install gitleaks     # required — the hook fails closed without it
npm install               # prepare script points core.hooksPath at .githooks
```

`npm install` runs `git config core.hooksPath .githooks`, so the hook is active
after a normal setup. To enable it by hand:

```bash
git config core.hooksPath .githooks
```

Rules live in `.gitleaks.toml`, which extends the upstream default set (Google
OAuth secrets, API keys, private keys, …) and adds three project-specific ones:

| Rule | Catches |
|---|---|
| `google-oauth-refresh-token` | `1//…` installed-app refresh tokens |
| `google-ads-developer-token` | a 22-char token next to a `developer_token` hint |
| `google-ads-customer-id` | 10-digit Ads account IDs near a `customer_id` hint |

The customer-ID rule is not about secrecy — an account ID is not a credential —
but it ties this public repo to a real Google Ads account. **Keep account
identifiers out of committed docs**; write `<redacted>` and point at the env var
instead. `VERIFIED.md` follows this convention.

Verified behaviour: the hook blocks a planted refresh token, developer token and
customer ID, blocks `git add -f .env`, and allows content using `<redacted>`.
Findings are printed with `--redact`, so the secret never reaches terminal
scrollback.

If a finding is a genuine false positive, add it to `[allowlist]` in
`.gitleaks.toml` rather than committing with `--no-verify`.

### Refresh tokens expire

If `npm run check:token` reports `invalid_grant`, the refresh token is dead. The
usual cause is the OAuth consent screen sitting in **Testing** mode, which caps
refresh tokens at 7 days. This project's consent screen is already **In
production** (verified 2026-08-21), so its token is long-lived — a failure here
would instead mean manual revocation or a rotated client secret. Mint a new
token with the same client ID/secret.

## Screens

| Route | What it is |
|---|---|
| `/` | New Search workbench — Paste \| Upload on the left, all settings on the right |
| `/runs` | Run history with live progress bars, and a ★ Saved filter |
| `/runs/[id]` | Results: summary, histogram, filters, table, export, save/refresh/delete |
| `/compare` | Two runs side by side, matched on Google's canonical keyword |
| `/settings` | Editable defaults, credential health check, fixed limits |

Under the `LIVE_MODE_THRESHOLD` (2,000 keywords) a run stays on the New Search
page with a progress bar; above it the run is submitted and you land on its page,
which shows the same bar. Either way the run survives leaving the page.

### The primary metric

The **low–high top-of-page bid band** is the primary metric, not average CPC.
It is what an advertiser must bid to appear at the top of the page, which is the
decision this tool exists to support. The **high top-of-page bid** drives heat
colouring, the histogram, the volume-weighted summary, the runs-list headline,
the filters and the default sort.

`average_cpc_micros` is kept everywhere as a secondary, informational column —
it is an undocumented modelled aggregate that must be explicitly requested and
vanishes silently when it is not. See VERIFIED.md §7 and §8, which also record
that avg CPC *does* respond to geo (US vs India differed 17–30×), so this is a
product decision rather than a workaround.

### Notes on the results screen

- **Heat bands** default to this run's tertiles, shown in a legend. Type
  absolute ₹ bounds into "Heat bands" to override them.
- **Clicking a histogram bar** filters the table to that ₹ bucket. Bars are
  coloured by their midpoint's band, so a bar spanning a band boundary takes the
  colour of its middle.
- **Sparklines** are drawn from whatever months came back, never assuming 12 —
  the newest month is eventually-consistent (VERIFIED.md §3).
- **Summary stats** are computed over canonical keywords, not submitted rows, so
  duplicates don't double-count the volume-weighted average. In "keep my list
  intact" mode the table therefore shows more rows than the "Unique keywords"
  figure.
- **Every numeric column sorts** — low and high top-of-page, avg CPC, volume and
  competition. Clicking a header cycles ascending → descending → back to the
  run's default. No-data rows sink to the bottom of a numeric sort whichever way
  it points; an absent bid is not "cheap". The keyword/position sort is exempt so
  that "keep my list intact" mode can still reproduce your original row order.
- **Select rows** with the checkbox column. The header checkbox selects the
  **current filtered view**, not the whole run, and shift-click selects a range,
  taking the state of the row you anchored on. Selections deliberately **survive
  filter changes** — narrow, pick, re-narrow, pick again, then export the union.
  Anything selected but hidden is reported next to the count.
- **Export** offers column selection and CSV/XLSX. In intact mode it preserves
  your original row order, and if the run came from an uploaded sheet your other
  columns are re-attached ahead of the metrics. **Export selected** applies the
  same rules to just the selected rows, still in their original order. It posts
  the selection rather than putting it in the URL, since a large one would
  exceed URL length limits.

### Saving, refreshing and deleting

- **★ Save forever** exempts a run from any future cleanup and adds it to the
  `★ Saved` filter on the Runs page.
- **Refresh** re-pulls the run from Google and adds a **Change** column showing
  per-keyword movement in the top-of-page bid since the previous pull — a rise
  in red (it costs more now), a fall in green. It deliberately **bypasses the
  monthly cache**, because serving the cached payload back would make every
  delta zero. The bypass is stored on the run, so a refresh interrupted by a
  restart resumes as a refresh.
  Google refreshes this data roughly monthly, so same-day refreshes usually
  report "no change" — that is the data, not a bug.
- **Delete** asks for confirmation, then removes the run and its keywords and
  metrics. `metrics_cache` is left alone: it is shared across runs and keyed by
  keyword, so clearing it would slow every other run down for no benefit.

### Comparing runs

Tick two finished runs on the Runs page and choose **Compare**. Keywords are
matched on **Google's canonical form**, so a run containing "cars" lines up with
one containing "car"; matching submitted text would miss that. Keywords present
in only one run are listed at the bottom rather than dropped, so a shrinking
list is visible rather than silent.

Comparison is useful across geos (run the same list for US and India), across
time (compare a saved run with a fresh one), or across settings.

### Column choices

Which columns are shown persists across runs and reloads, in `localStorage`. The
saved preference is authoritative — including for the Change column — so a
toggle always does what it says.

### Settings

Defaults for location, language and the live-mode threshold are stored in a
single-row `app_settings` table and pre-fill the New Search panel; any run can
still override them. Env vars remain the fallback for anything unset, so a
fresh database behaves identically.

**Test API connection** runs a live 3-keyword probe and reports the account
currency and a sample price — worth using before a large run, since it surfaces
a credential or quota problem immediately rather than halfway through.
It costs one API operation.

## The runner

Runs can also be driven from the CLI, which is handy for large lists and for
resuming:

```bash
npm run run:keywords -- --keywords "gardening tools,lawn mower" --tag garden
npm run run:keywords -- --file keywords.txt --name "Q3 audit" --months 3
npm run run:keywords -- --list
npm run run:keywords -- --show <run-id> [--mode deduped]
npm run run:keywords -- --resume <run-id>     # or --resume all
```

Scripts run with `--conditions=react-server` so the `server-only` marker in
`src/lib/*` resolves to a no-op instead of throwing outside Next.

### How a run works

1. Every submitted row is stored in `run_keywords` with its position —
   duplicates and original casing included, so "keep my list intact" mode can
   replay the user's list exactly.
2. Distinct normalised keywords, in first-appearance order, are split into
   chunks of **5,000**. That ordering is deterministic, which is what makes
   `runs.chunk_cursor` meaningful across a restart.
3. Each chunk checks `metrics_cache` first. A payload fetched in the current
   calendar month is reused — Google refreshes this data monthly.
4. Whatever is left goes to the API in one request, then results are written and
   `chunk_cursor` advances. A crash mid-run leaves the cursor where it was, so
   resuming continues rather than restarting.

Chunk size is 5,000 rather than the API's 10,000 ceiling because quota is
charged **per request, not per keyword** — a bigger chunk is strictly cheaper —
but a 10,000-row response is a large payload and the progress bar would barely
move. See VERIFIED.md §6.

### Rate limiting

Planning methods allow **1 request/second per customer ID**. All requests pass
through a single process-wide queue, so concurrent runs cannot together exceed
it. The OAuth token is fetched *before* a rate-limit slot is taken — acquiring
the slot first meant a cold-start token refresh ate ~200ms of the interval and
pushed real spacing to 895ms, which is what earns `RESOURCE_EXHAUSTED`.
Concurrent callers share one in-flight token refresh.

Retries use exponential backoff with jitter on 429, 5xx, `RESOURCE_EXHAUSTED`
and network errors; a 401 drops the cached token and retries once.

### Resume on restart

`src/instrumentation.ts` runs at boot and picks up any run left `running` or
`queued`. It is deliberately **not** awaited — Next's `register` must finish
before the server accepts requests, so a large interrupted run would otherwise
block startup. The resume proceeds in the background.

## Layout

```
db/migrations/       Numbered .sql files, applied in filename order
scripts/             CLI tools (migrate, token check, smoke test, runner)
src/app/             App Router pages and route handlers
src/components/      Shared UI (header, theme toggle, primitives)
src/lib/             Server-only modules:
                       env.ts           validated env access
                       db.ts            pg pool
                       session.ts       password + signed cookie
                       google-ads.ts    REST client, throttle, retry
                       keywords.ts      parsing and normalisation
                       run-settings.ts  settings type, defaults, cache hash
                       runner.ts        chunking, cache, dedup, resume
                       results.ts       reading runs back out
                       spreadsheet.ts   CSV/XLSX parsing for uploads
                       export.ts        CSV/XLSX generation
                       heat.ts          CPC bands and histogram buckets
                       format.ts        ₹ and number formatting (client-safe)
                       types.ts         types shared with client components
src/instrumentation.ts  Boot hook — resumes interrupted runs
src/proxy.ts         Auth guard (Next 16's renamed middleware)
```

### Theming

The theme is applied three ways, deliberately layered:

1. An inline script in the root layout sets `data-theme` before first paint — no
   flash of the wrong theme on a normal page load.
2. The stylesheet also honours `prefers-color-scheme`, so a render where that
   script did not run still gets the right theme.
3. `ThemeSync` re-applies the stored choice after hydration.

Layers 2 and 3 exist because Next serves its **own HTML shell**
(`<html id="__next_error__">`) for the not-found and error paths — the root
layout arrives only in the RSC payload and renders on the client, so the inline
script never executes and `data-theme` is absent. Without the fallbacks, a user
who chose dark saw those pages in light. React logs a benign
"Encountered a script tag while rendering React component" warning on that path
for the same reason; it is expected, and the theme is correct regardless.

### Auth model

`src/proxy.ts` does an **optimistic** check only — is a session cookie present?
Per the Next.js auth guide, proxy runs on every request including prefetches, so
it must stay cheap. The **authoritative** check is `getSession()` from
`src/lib/session.ts`, which verifies the HMAC and expiry; every protected page
and route handler calls it.

Because the optimistic check can't tell a valid cookie from a stale one, the
proxy never redirects a cookie-bearing request *away* from `/login` — the login
page decides that itself after verifying the signature. Otherwise an expired
cookie would bounce forever between `/` and `/login`.

Sessions are stateless, so signing out clears the browser cookie but does not
revoke a token that was already copied; it remains valid until it expires (30
days). Rotate `SESSION_SECRET` to invalidate every outstanding token at once.

`/api/*` is excluded from the proxy matcher so API clients get a `401` JSON body
rather than a `307` to an HTML page.

### Database

Schema mirrors PLAN.md §4. The optional `jobs` table is folded into `runs`: the
resume point lives in `runs.chunk_cursor`, so a run interrupted by a restart can
pick up at the right chunk without a second table.

Migrations are forward-only and tracked in `schema_migrations`. Add a new
numbered file rather than editing an applied one.

## Deploying to Railway

Nothing in the app reads a file for configuration — every setting is an env var
— so a deploy is: provision Postgres, copy the vars, run migrations, start.

**1. Provision.** Create a Railway project, add the **Postgres** plugin, and add
this repo as a service. Railway detects Next.js and runs `npm run build` /
`npm start`.

**2. Environment.** Copy every variable from `.env.example` into the service.
`DATABASE_URL` can reference the plugin directly:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Set a fresh `SESSION_SECRET` for production (`openssl rand -base64 36`) rather
than reusing the local one — rotating it invalidates every outstanding session,
which is what you want if the local value has ever been shared.

**3. Migrations.** Add a release command so schema changes apply before the new
version serves traffic:

```
npm run db:migrate
```

Migrations are forward-only and tracked in `schema_migrations`, so re-running is
safe and applies only what is new.

**4. Verify.** Open `/settings` and press **Test API connection**. It reports
the account currency and a sample price, which catches a mis-copied credential
immediately.

### Things worth knowing before you deploy

- **`NODE_ENV=production` marks the session cookie `Secure`**, so the app must be
  served over HTTPS. Railway does this by default.
- **Runs execute in-process.** A deploy mid-run kills it, but nothing is lost:
  `runs.chunk_cursor` persists and `src/instrumentation.ts` resumes interrupted
  runs at boot. Prefer deploying when nothing large is running anyway.
- **Do not scale beyond one instance.** The 1 rps rate limiter is per-process,
  so two instances would together exceed Google's limit and earn
  `RESOURCE_EXHAUSTED`. A second instance would also duplicate boot-time
  resumes. This is a single-user tool; one instance is the design.
- **Uploaded sheets are stored in Postgres** (`run_uploads`) so exports can
  re-attach the user's other columns. A few thousand rows is a few MB — fine,
  but it is the table that will grow fastest.
- **Back up before deleting runs.** There is no undo on the delete action.