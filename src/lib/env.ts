import "server-only";

/**
 * Validated, 12-factor env access. Every value the app needs comes from here so
 * that a missing var fails loudly at first use instead of as an undefined deep
 * inside a request handler. See README §Environment for what each var is.
 */

type EnvKey =
  | "DATABASE_URL"
  | "APP_PASSWORD"
  | "SESSION_SECRET"
  | "GOOGLE_ADS_DEVELOPER_TOKEN"
  | "GOOGLE_ADS_CLIENT_ID"
  | "GOOGLE_ADS_CLIENT_SECRET"
  | "GOOGLE_ADS_REFRESH_TOKEN"
  | "GOOGLE_ADS_LOGIN_CUSTOMER_ID"
  | "GOOGLE_ADS_CUSTOMER_ID";

function required(key: EnvKey): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appPassword() {
    return required("APP_PASSWORD");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get googleAds() {
    return {
      developerToken: required("GOOGLE_ADS_DEVELOPER_TOKEN"),
      clientId: required("GOOGLE_ADS_CLIENT_ID"),
      clientSecret: required("GOOGLE_ADS_CLIENT_SECRET"),
      refreshToken: required("GOOGLE_ADS_REFRESH_TOKEN"),
      loginCustomerId: required("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
      customerId: required("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, ""),
    };
  },
  /** Keyword count at or below which a run stays on-page instead of backgrounding. */
  get liveModeThreshold() {
    const raw = process.env.LIVE_MODE_THRESHOLD;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
  },
};

/**
 * Reports which vars are present without reading their values, for the
 * Settings-screen health check. Never returns secret material.
 */
export function envHealth(): { key: EnvKey; present: boolean }[] {
  const keys: EnvKey[] = [
    "DATABASE_URL",
    "APP_PASSWORD",
    "SESSION_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CUSTOMER_ID",
  ];
  return keys.map((key) => ({
    key,
    present: Boolean(process.env[key] && process.env[key]!.trim() !== ""),
  }));
}
