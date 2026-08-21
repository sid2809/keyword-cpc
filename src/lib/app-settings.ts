import "server-only";
import { query } from "./db";
import { env } from "./env";
import { DEFAULT_SETTINGS, US_GEO, ENGLISH } from "./run-settings";
import type { RunSettings } from "./types";

/**
 * User-editable defaults (PLAN.md §6 screen 4), stored in a single row.
 *
 * Env vars stay the fallback for anything null in the table, so the app behaves
 * identically on a fresh database and a Railway deploy where nobody has opened
 * the Settings screen yet.
 */

export type AppSettings = {
  liveModeThreshold: number;
  defaultGeo: string;
  defaultLanguage: string | null;
};

type Row = {
  live_mode_threshold: number | null;
  default_geo: string | null;
  default_language: string | null;
};

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await query<Row>(
    "select live_mode_threshold, default_geo, default_language from app_settings where id = 1",
  );
  const row = rows[0];
  return {
    liveModeThreshold: row?.live_mode_threshold ?? env.liveModeThreshold,
    defaultGeo: row?.default_geo ?? US_GEO,
    // An explicitly stored empty string means "unset the language" — distinct
    // from never having chosen, which falls back to English.
    defaultLanguage: row ? (row.default_language === "" ? null : (row.default_language ?? ENGLISH)) : ENGLISH,
  };
}

export async function saveAppSettings(next: Partial<AppSettings>): Promise<void> {
  const current = await getAppSettings();
  const merged = { ...current, ...next };
  await query(
    `insert into app_settings (id, live_mode_threshold, default_geo, default_language, updated_at)
     values (1, $1, $2, $3, now())
     on conflict (id) do update set
       live_mode_threshold = excluded.live_mode_threshold,
       default_geo         = excluded.default_geo,
       default_language    = excluded.default_language,
       updated_at          = now()`,
    [merged.liveModeThreshold, merged.defaultGeo, merged.defaultLanguage ?? ""],
  );
}

/** Run settings pre-filled from the user's saved defaults. */
export async function defaultRunSettings(): Promise<RunSettings> {
  const app = await getAppSettings();
  return {
    ...DEFAULT_SETTINGS,
    geoTargetConstants: [app.defaultGeo],
    language: app.defaultLanguage,
  };
}
