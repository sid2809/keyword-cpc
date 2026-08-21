# Keyword CPC

Bulk keyword CPC and search-volume research using the Google Ads
`KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics` endpoint. Single user,
local-first, Railway-deployable later.

Build plan and locked decisions live in [PLAN.md](./PLAN.md). Verified API facts
will be recorded in `VERIFIED.md` at the end of Phase 1.

**Status: Phase 0 complete** — Next.js app, Postgres schema, password login and
env plumbing. No Google Ads calls are wired into the app yet.

## Stack

| | |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) + React 19 |
| Styling | Tailwind CSS v4, design tokens per PLAN.md §5 |
| Database | PostgreSQL 16 (`pg`, no ORM) |
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

### Refresh tokens expire

If `npm run check:token` reports `invalid_grant`, the refresh token is dead. The
usual cause is the OAuth consent screen sitting in **Testing** mode, which caps
refresh tokens at 7 days. This project's consent screen is already **In
production** (verified 2026-08-21), so its token is long-lived — a failure here
would instead mean manual revocation or a rotated client secret. Mint a new
token with the same client ID/secret.

## Layout

```
db/migrations/       Numbered .sql files, applied in filename order
scripts/             One-off CLI tools (migrate, token check)
src/app/             App Router pages and route handlers
src/components/      Shared UI (header, theme toggle)
src/lib/             env, db pool, session — all server-only
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
