"use client";

import { useActionState, useState, useTransition } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, CONTROL, Card, Field } from "@/components/ui";
import { testApiConnection, updateSettings, type ProbeState, type SettingsState } from "@/app/actions";

const GEO_OPTIONS = [
  { value: "geoTargetConstants/2840", label: "United States" },
  { value: "geoTargetConstants/2356", label: "India" },
  { value: "geoTargetConstants/2826", label: "United Kingdom" },
  { value: "geoTargetConstants/2036", label: "Australia" },
  { value: "geoTargetConstants/2124", label: "Canada" },
];

const LANGUAGE_OPTIONS = [
  { value: "languageConstants/1000", label: "English" },
  { value: "languageConstants/1005", label: "Japanese" },
  { value: "languageConstants/1003", label: "German" },
  { value: "languageConstants/1002", label: "French" },
  { value: "languageConstants/1010", label: "Spanish" },
  { value: "", label: "Any (unset)" },
];

const INITIAL: SettingsState = { ok: false, message: null };

export function SettingsForm({
  threshold,
  geo,
  language,
}: {
  threshold: number;
  geo: string;
  language: string | null;
}) {
  const [state, action, saving] = useActionState(updateSettings, INITIAL);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text">Defaults for new searches</h2>
      <p className="mt-0.5 text-xs text-text-muted">
        These pre-fill the New Search panel. Any run can still override them.
      </p>

      <form action={action} className="mt-4 space-y-4">
        <Field
          label="Live-mode threshold"
          htmlFor="threshold"
          hint="Runs at or below this many keywords stay on the page; larger ones go to the background."
        >
          <input
            id="threshold"
            name="threshold"
            type="number"
            min={1}
            defaultValue={threshold}
            className={`${CONTROL} num w-40`}
          />
        </Field>

        <Field label="Default location" htmlFor="geo">
          <select id="geo" name="geo" defaultValue={geo} className={`${CONTROL} w-full max-w-sm`}>
            {GEO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default language" htmlFor="language">
          <select
            id="language"
            name="language"
            defaultValue={language ?? ""}
            className={`${CONTROL} w-full max-w-sm`}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save defaults"}
          </button>
          {state.message && (
            <span
              role="status"
              className={`text-sm ${state.ok ? "text-heat-green" : "text-heat-red"}`}
            >
              {state.message}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

/** "Test API connection" — a 3-keyword probe (PLAN.md §6 screen 4). */
export function ConnectionTest() {
  const [result, setResult] = useState<ProbeState | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text">Credential health</h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Runs a live 3-keyword probe against the Google Ads API and reports the account currency and a
        sample price. Costs one API operation.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              setResult(await testApiConnection());
            })
          }
          className={BTN_SECONDARY}
        >
          {pending ? "Testing…" : "Test API connection"}
        </button>
      </div>

      {result && (
        <p
          role="status"
          className={`mt-3 rounded-[var(--radius-control)] border border-border p-3 text-sm ${
            result.ok ? "text-heat-green" : "text-heat-red"
          }`}
        >
          {result.message}
        </p>
      )}
    </Card>
  );
}
