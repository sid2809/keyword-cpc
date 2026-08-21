# Verified facts

Answers to the `VERIFY` list in [PLAN.md](./PLAN.md) §2, recorded as each one is
tested against the live API. Nothing here is assumed — every entry names how it
was checked and when.

---

## 0. Refresh token validity — ✅ PASS (2026-08-21)

**Checked with:** `npm run check:token` — a bare `grant_type=refresh_token` POST
to `https://oauth2.googleapis.com/token` using the existing client ID/secret.

**Result:** HTTP 200. Access token issued, `expires_in` 3599s, `token_type`
Bearer, `scope` `https://www.googleapis.com/auth/adwords`.

The refresh token in `.env` is **not** expired, and it carries the correct
`adwords` scope, so no re-minting is needed.

**Consent screen mode:** *In production* — confirmed by the user on 2026-08-21
from Google Cloud Console → APIs & Services → OAuth consent screen. This is not
exposed by any API, so it can only be read from the console. It matters because
*Testing*-mode refresh tokens expire 7 days after issue; because this app is
published, the refresh token is long-lived and will not need periodic
re-minting.

Re-run `npm run check:token` if API calls ever start failing with
`invalid_grant` (the remaining causes would be manual revocation or a rotated
client secret).

---

## 1. Currency of returned micros — not yet tested (Phase 1)

## 2. `average_cpc_micros` behaviour and units — not yet tested (Phase 1)

## 3. Whether `year_month_range` affects aggregates or only the volume series — not yet tested (Phase 1)

## 4. Client library choice (Opteo `google-ads-api` vs direct REST) — not yet tested (Phase 1)

## 5. Basic-access daily quota headroom — not yet tested (Phase 1)
