# Keyword CPC

Bulk keyword CPC and search-volume research using the Google Ads
`KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics` endpoint. Single user,
local-first, Railway-deployable later.

Build plan and locked decisions live in [PLAN.md](./PLAN.md). API behaviour that
was tested against the live endpoint — including three things the plan got wrong
— is recorded in [VERIFIED.md](./VERIFIED.md).

**Status: Phase 3 complete** — the app is usable end to end: paste or upload
keywords, watch progress, then filter, chart and export the results. Run
history, saved searches, refresh/delta and the settings screen are Phase 4.

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
| `/runs` | Run history with live progress bars |
| `/runs/[id]` | Results: summary, CPC histogram, filters, table, export |
| `/settings` | Current configuration (editable in Phase 4) |

Under the `LIVE_MODE_THRESHOLD` (2,000 keywords) a run stays on the New Search
page with a progress bar; above it the run is submitted and you land on its page,
which shows the same bar. Either way the run survives leaving the page.

### Notes on the results screen

- **CPC heat bands** default to this run's tertiles, shown in a legend. Type
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
- **Export** offers column selection and CSV/XLSX. In intact mode it preserves
  your original row order, and if the run came from an uploaded sheet your other
  columns are re-attached ahead of the metrics.

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

Not done yet (PLAN.md §9 parks it for v1). Config is 12-factor — every setting is
an env var, no file-based config — so the move should be: provision a Postgres
plugin, copy `DATABASE_URL` and the rest of the vars into Railway, and run
`npm run db:migrate` as a release step. `NODE_ENV=production` automatically marks
the session cookie `Secure`.
