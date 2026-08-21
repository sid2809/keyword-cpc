/**
 * PLAN.md §2 VERIFY 0 — refresh-token validity.
 *
 * Exchanges GOOGLE_ADS_REFRESH_TOKEN for an access token and reports the
 * result. Prints no secret material. Run with `npm run check:token`.
 *
 * If this fails with `invalid_grant`, the refresh token is dead. Common causes:
 *   - The OAuth consent screen is still in "Testing" mode, which expires
 *     refresh tokens after 7 days. Fix by publishing the app ("In production")
 *     in Google Cloud Console → APIs & Services → OAuth consent screen, then
 *     minting a new refresh token.
 *   - The token was revoked, or the client secret was rotated.
 */
import "dotenv/config";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function main() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  const missing = Object.entries({
    GOOGLE_ADS_CLIENT_ID: clientId,
    GOOGLE_ADS_CLIENT_SECRET: clientSecret,
    GOOGLE_ADS_REFRESH_TOKEN: refreshToken,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type: "refresh_token",
    }),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    console.error(`FAIL (HTTP ${res.status})`);
    console.error(`  error: ${json.error}`);
    console.error(`  description: ${json.error_description}`);
    if (json.error === "invalid_grant") {
      console.error("\n  invalid_grant → the refresh token is expired or revoked.");
      console.error("  See the header comment in this file for how to mint a new one.");
    }
    process.exit(1);
  }

  const scope = String(json.scope ?? "");
  console.log("OK — refresh token is valid.");
  console.log(`  access token length: ${String(json.access_token ?? "").length}`);
  console.log(`  expires_in: ${json.expires_in}s`);
  console.log(`  scope: ${scope}`);

  if (!scope.includes("https://www.googleapis.com/auth/adwords")) {
    console.error("\n  WARNING: the adwords scope is missing — Google Ads API calls will fail.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
