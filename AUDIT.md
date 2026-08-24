# Pre-deploy audit — 2026-08-24

Adversarial audit of the whole application before the first Railway deploy. No
features were added; the one exception is login rate limiting, which was
explicitly requested as a security fix and is recorded as F4 below.

**Result: 7 defects found, 7 fixed.** Every suite re-run green afterwards
(12/12 suites, 300+ individual assertions, against both the dev server and a
real `next start` production build).

The harness lives in `scratch/audit/` — it is gitignored and therefore local
only. Say the word if you want it committed as a permanent regression suite.

---

## Findings

### F1 — Malformed run ids returned HTTP 500 · **fixed** · severity: medium

`/api/runs/{id}/progress` and `/api/runs/{id}/export` passed the URL segment
straight to Postgres, which raised `invalid input syntax for type uuid` and
surfaced as a 500. Sixteen distinct malformed ids reproduced it, including
`not-a-uuid`, `../../etc/passwd`, `'; drop table runs; --` and a 500-character
string.

The *page* routes were hardened in Phase 5; the API routes were missed.

**Not** an injection vulnerability — queries are parameterised throughout, and
the SQL-shaped inputs were rejected by the type system, not executed. The defect
is that a hostile or merely mistyped URL produced a server error and a stack
trace in the logs instead of a 404.

**Fix:** `src/lib/ids.ts` holds a single `isRunId`. `getRun()` now rejects
malformed ids at the source, so every caller is covered, and `getResults` /
`getRunSummary` guard as well. Verified: all 16 inputs now return 404.

### F2 — Wrong-typed request bodies returned HTTP 500 · **fixed** · severity: medium

`POST /api/runs` assumed the shape of everything it was given. Seven bodies
crashed it: `null`, `keywords` as a bare string, as numbers, as objects, `text`
as a number, and an `upload` object missing `rows` (which wrote JSON `null` into
a `NOT NULL` jsonb column **after** the run had been created, leaving an orphan).

**Fix:** the body is validated and coerced before use — non-object bodies
rejected, keyword entries coerced to strings and capped at 500 characters,
`name`/`tag`/`filename` capped at 200, `source` restricted to its enum, and an
`upload` accepted only when `columns`/`rows`/`keywordColumn` are internally
consistent. An out-of-range `urlColumn` is dropped rather than silently reading
`undefined`.

### F3 — A NUL byte in a keyword killed the whole run · **fixed** · severity: high

A keyword containing `U+0000` reached the driver and the INSERT died with
`invalid byte sequence for encoding "UTF8": 0x00`, failing the entire run — not
just the offending keyword.

This is reachable without malice: control characters are common in text pasted
out of PDFs, and any file exported from a system that pads fields can carry
them.

**Fix:** `tidy()` — the single function every keyword passes through — now
strips C0/C1 control characters and unpaired surrogates (also invalid UTF-8)
before whitespace collapsing. Emoji, accented Latin and Cyrillic are preserved;
verified explicitly.

### F4 — No brute-force protection on login · **fixed** · severity: high

Measured **74 password attempts per second**, with none blocked. Against an
8-character password that is not a comfortable margin, and the app is about to
be exposed on the public internet.

**Fix:** `src/lib/login-rate-limit.ts`. Four failures are allowed, the fifth
locks for 30 seconds, and each subsequent lock doubles to a 5-minute ceiling. A
success resets the counter, and failures decay after 15 quiet minutes so honest
typos never accumulate.

The limiter is **global rather than per-IP**, deliberately: behind Railway's
proxy the only client address available is `x-forwarded-for`, which the client
sets, so a per-IP limit is bypassed by rotating one header. There is exactly one
legitimate user, so a global lock is both unspoofable and acceptable. The
trade-off is that an attacker can lock the real user out for the cooldown —
which is why the cooldown is minutes, not hours.

Verified end to end from a clean limiter: 4 typos allowed → locks on the 5th →
the correct password is refused during cooldown → **the real user gets back in
after ~30 s**. That last check matters most; a lockout that never releases would
be a worse bug than the one it fixes.

### F5 — Malformed run settings created a doomed run · **fixed** · severity: medium

`settings: { geoTargetConstants: "x" }` was accepted with a 201. The run was
created, chunked, and only then rejected by Google with
`RESOURCE_NAME_MALFORMED: Resource name 'x' is malformed`. Five such corpses
were sitting in the database when I inventoried it. My own "not 5xx" assertion
had passed this — it was found by looking at what the runs actually did
afterwards, not at the response code.

**Fix:** `withDefaults()` now sanitises field by field instead of merging
blindly — geo targets must match `geoTargetConstants/{id}` and are capped at the
API's limit of 10, language must match `languageConstants/{id}` or be explicitly
null, and network / monthsBack / dedupMode are restricted to their enums.
Anything malformed falls back to the default. Verified: both previously-fatal
payloads now complete normally.

### F6 — Asymmetric currency rounding on negative values · **fixed** · severity: low

`microsToRupees(-1_505_000)` returned `-1.50` while `+1_505_000` returned
`+1.51`, because `Math.round` breaks halves toward +∞.

Unreachable today — bids are never negative and every delta is passed through
`Math.abs` before formatting — but asymmetric rounding has no business in a
currency function. Fixed by rounding the magnitude and reapplying the sign.
Positive values are bit-for-bit unchanged (verified).

### F7 — Export attached the wrong source row · **fixed (previous commit)** · severity: high

Recorded here for completeness because it was found by the same
verify-don't-assume pass and is the most serious of the set.
`run_keywords.position` counts only non-empty keywords, but exports indexed the
uploaded sheet with it, so a single blank keyword cell shifted every later row
onto the wrong source data. With `[gardening tools, <blank>, lawn mower]`,
"lawn mower" came back carrying the blank row's URL and notes and the real last
row vanished.

Fixed by recording `source_row`. **This audit found the trigger is more common
than assumed:** an XLSX with **merged cells** produces exactly this shape — the
non-top-left cells of a merge parse as empty. Merged header or category cells
are ordinary in exported sheets.

---

## What was tested

### Regression
- `tsc --noEmit`, `eslint`, `next build` — all clean.
- **Migrations on a completely empty database** (twice, simulating Railway's
  fresh Postgres): all four apply in order, produce the full seven-table schema,
  seed the `app_settings` row, and re-running is a correct no-op.

### Input hostility — 92 assertions, run against dev *and* production
- Every API route unauthenticated → 401 (7 routes).
- Five tampered cookie shapes (bogus, `a.b`, 5 KB, empty, percent-encoded NULs) → 401.
- 18 malformed `POST /api/runs` bodies.
- 8 malformed ids × 3 routes.
- Export query params: bad format, empty columns, 5,000 columns, `__proto__`,
  bad mode; and POST bodies with a non-array selection, numeric entries, nulls,
  and a 50,000-entry selection.
- **Uploads:** empty, whitespace-only, header-only, no header row, duplicate
  headers, BOM, CRLF, quoted commas, quoted newlines, ragged rows, a URL column
  full of garbage, wrong extension, XLSX extension with CSV bytes, NUL bytes,
  and a 16 MB file (rejected by the 15 MB cap).
- **XLSX** built as raw OOXML because `write-excel-file` cannot author either
  case: **formulas** (cached values read correctly — `CONCATENATE` → `lawn
  mower`, `1+1` → `2`) and **merged cells** (produce the blank-keyword row noted
  in F7).
- **Paste:** whitespace-only, commas-only, emoji, non-ASCII (German, Spanish,
  Russian, Japanese), a 50,000-character keyword, **10,001 keywords** (chunks
  correctly), control characters, and HTML/script payloads.

### Runner failure modes
- **Shared 1 rps throttle — proven, not assumed.** Five runs executed
  concurrently produced exactly five outbound requests spaced **1101, 1101,
  1102, 1100 ms** apart. Per-run throttling would have fired all five at once
  (~225 ms). Re-confirmed over the real HTTP path: four concurrent background
  runs took 4,150 ms, consistent with serialised requests, and none hit
  `RESOURCE_EXHAUSTED`.
- **RESOURCE_EXHAUSTED** injected mid-run: retried 5 times with backoff over 36 s,
  then failed visibly; chunk 1's 5,000 rows preserved; resumed without refetching
  chunk 1.
- **Network timeout** (`ETIMEDOUT`): same behaviour, clear message.
- **Transient failure** (two failures then success): recovered automatically and
  completed — proving backoff works, not just that it gives up.
- **invalid_grant** mid-run: failed **immediately** without burning retries, with
  an actionable message naming `npm run check:token`; resumed cleanly afterwards.
- **Boot resume covers `queued`, not just `running`.** Two runs abandoned when a
  server was killed while they waited behind the throttle sat in `queued`; the
  next start drained both ("resumed 2 interrupted run(s) at boot"). Worth
  knowing: resumption happens **only at boot**, so a run orphaned by a crash
  waits for the next restart rather than being swept up periodically.
- **SIGKILL mid-chunk:** a 30,000-keyword / 6-chunk run was killed at
  `chunk_cursor=1`. The process died with the run still marked `running`; on
  restart `instrumentation.ts` picked it up at chunk 2/6 and finished all 30,000
  with **no rows lost or duplicated**.

### Data integrity
- **Export alignment fuzz:** 12 randomised sheets (and 6 more against
  production) with random blank keyword cells, duplicate keywords carrying the
  same and different URLs, and extra columns — every export verified cell by cell
  against the source sheet, in **both** intact and deduped modes. Deduped URL
  aggregation checked against an independently computed expectation.
- **Currency and numeric edges:** zero, null, sub-paise, exact-half rounding,
  lakh/crore grouping, negatives, `MAX_SAFE_INTEGER` and beyond. Heat bands and
  the histogram with empty input, all-null, all-zero, a single value, an extreme
  spread, and 1,000 values — no NaN, no Infinity, no lost or double-counted rows.

### Production mode (`next start`, not dev)
The full API suite, XLSX suite and export fuzz re-run against the production
build, plus a complete browser journey: login (wrong then right), dark and light
themes surviving reload, a real run start-to-finish, sorting, filtering,
shift-click selection, a CSV download of the selection, a full XLSX download
parsed back, runs/settings/compare screens, the 404 and malformed-id paths, and
sign-out redirect. **Zero console or page errors in production.**

Confirmed the production cookie is `Secure; HttpOnly; SameSite=lax` — correct
for Railway, and the reason plain-HTTP tooling must set the cookie header
explicitly (browsers exempt `localhost`).

### Security
- **gitleaks over all 12 commits of history: clean.** A working-tree scan
  reported 79 hits; all 79 are in `.env` (6) and `.next` (73), both gitignored,
  and `git check-ignore` confirms **zero** are in files git would track.
- The `.next` hits are in Turbopack's local build cache. Verified independently
  that the client secret, refresh token, app password and session secret appear
  in **no** file under `.next/static` — and in fact in no server chunk either,
  because env vars are read at runtime rather than inlined at build time.
- `npm audit`: **0 vulnerabilities**, production and full.
- No `.env`, key or credential file is tracked.

---

## What remains untestable, or untested by choice

These are honest gaps, not passes.

1. **The Railway deploy itself.** Everything was verified against a local
   production build. Platform specifics — the release command actually running,
   `${{Postgres.DATABASE_URL}}` interpolation, HTTPS termination, container
   restarts — can only be confirmed on Railway.
2. **Real upstream failures.** `RESOURCE_EXHAUSTED`, network timeouts and
   `invalid_grant` were *simulated* by intercepting fetch. The handling paths are
   proven; Google's exact real-world payloads may differ in wording.
3. **Actual quota exhaustion.** The 15,000 operations/day ceiling was never
   approached — the whole audit spent roughly 30 API calls. Behaviour at the
   daily limit is inferred from documentation, not observed.
4. **Multi-instance deployment.** The 1 rps limiter is per-process and was proven
   correct *within* one process. Two instances would each get their own limiter
   and together exceed Google's limit. This is documented in the README as
   unsupported; nothing enforces it, so setting Railway's replica count above 1
   would silently break rate limiting.
5. **The login limiter resets on restart.** State is in memory. An attacker
   cannot restart the server, so this is not a practical bypass, but a crash-loop
   would clear the counter repeatedly.
6. **Password strength.** Rate limiting bounds the guess rate; it cannot rescue a
   dictionary word. `APP_PASSWORD` is 8 characters — consider lengthening it
   before the app is publicly reachable.
7. **Password-length timing.** `verifyPassword` is constant-time for equal-length
   inputs but returns early on a length mismatch, so response timing leaks the
   password's *length*. Low value to an attacker and now bounded by the rate
   limiter; not fixed to avoid touching working auth on the eve of deploy.
8. **Google's canonical dedup for arbitrary keywords.** The export fuzz uses
   synthetic keywords Google returns unchanged, so the expected mapping is
   computable. Real near-variant collapsing (`car`/`cars`) is verified separately
   in VERIFIED.md §6 but is not part of the randomised fuzz.
9. **XLSX from real Excel / Google Sheets.** The formula and merged-cell files
   are hand-built OOXML. They exercise the reader's handling of those constructs,
   but a genuine export carries far more incidental markup.
10. **OAuth consent screen mode.** Not exposed by any API; confirmed once from
    the Cloud Console (VERIFIED.md §0) and unverifiable from code.
11. **Concurrency on a single run.** Two simultaneous refreshes of the *same*
    run were not tested; `refreshRun` rejects a run that is `running`, but the
    check is not atomic, so a precisely-timed double click is theoretically
    racy. Single-user app; low risk.
12. **Long-run behaviour at the 10,000-per-request ceiling.** Chunking at 5,000
    was exercised repeatedly; a single 10,000-keyword request was verified once
    during Phase 1 but not under audit conditions.

---

## Verdict

Nothing found blocks the deploy. F3 and F4 were the two worth catching — a
single stray control character could kill an entire 2,000-keyword run, and 74
guesses per second against an 8-character password is thin cover for something
about to be public.

Before going live: lengthen `APP_PASSWORD`, set a fresh `SESSION_SECRET` for
production, and keep the Railway replica count at 1.
