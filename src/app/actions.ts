"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { deleteRun, refreshRun, setSavedForever } from "@/lib/run-actions";
import { saveAppSettings } from "@/lib/app-settings";
import { generateKeywordHistoricalMetrics, getAccountInfo } from "@/lib/google-ads";
import { DEFAULT_SETTINGS } from "@/lib/run-settings";
import { formatMicros } from "@/lib/format";

/**
 * Server actions for Phase 4. Every one re-checks the session — a server action
 * is a POST endpoint, so the proxy's page-level guard does not cover it.
 */

async function requireSession() {
  if (!(await getSession())) throw new Error("Unauthorized");
}

export async function toggleSavedForever(runId: string, saved: boolean): Promise<void> {
  await requireSession();
  await setSavedForever(runId, saved);
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
}

export async function removeRun(runId: string): Promise<void> {
  await requireSession();
  await deleteRun(runId);
  revalidatePath("/runs");
  revalidatePath("/");
  redirect("/runs"); // throws — must stay outside try/catch
}

export async function startRefresh(runId: string): Promise<void> {
  await requireSession();
  await refreshRun(runId);
  revalidatePath(`/runs/${runId}`);
}

export type SettingsState = { ok: boolean; message: string | null };

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireSession();

  const threshold = Number(formData.get("threshold"));
  if (!Number.isFinite(threshold) || threshold < 1) {
    return { ok: false, message: "Threshold must be a positive whole number." };
  }

  await saveAppSettings({
    liveModeThreshold: Math.floor(threshold),
    defaultGeo: String(formData.get("geo") ?? ""),
    defaultLanguage: String(formData.get("language") ?? "") || null,
  });

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export type ProbeState = { ok: boolean; message: string | null };

/**
 * "Test API connection" (PLAN.md §6 screen 4): a 3-keyword probe reporting the
 * account currency and a sample CPC, so a credential or quota problem surfaces
 * here rather than halfway through a real run.
 */
export async function testApiConnection(): Promise<ProbeState> {
  await requireSession();
  try {
    const account = await getAccountInfo();
    const probe = await generateKeywordHistoricalMetrics(
      ["gardening tools", "lawn mower", "garden hose"],
      DEFAULT_SETTINGS,
    );

    const withData = probe.find((r) => !r.noData && r.metrics);
    const sample = withData
      ? `${withData.text} — top-of-page ${formatMicros(withData.metrics!.highTopOfPageBidMicros)}, ` +
        `avg CPC ${formatMicros(withData.metrics!.averageCpcMicros)}`
      : "no sample metrics returned";

    return {
      ok: true,
      message:
        `Connected to ${account.descriptiveName ?? "the account"} · currency ${account.currencyCode ?? "unknown"}` +
        `${account.testAccount ? " · TEST ACCOUNT" : ""} · ${probe.length} keywords returned · ${sample}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "The probe failed." };
  }
}
