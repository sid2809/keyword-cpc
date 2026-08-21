"use client";

import { BTN_PRIMARY, CONTROL, Field, SegmentedControl } from "@/components/ui";
import { estimateSeconds, formatDuration, formatInt } from "@/lib/format";
import type { RunSettings } from "@/lib/types";

/**
 * Right panel of the workbench (PLAN.md §6): every setting visible at once,
 * sensible defaults pre-filled so it can be ignored entirely, and the primary
 * action pinned to the bottom of the card.
 */

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

export function SettingsPanel({
  settings,
  onChange,
  name,
  onNameChange,
  tag,
  onTagChange,
  keywordCount,
  uniqueCount,
  chunkSize,
  threshold,
  submitting,
  onSubmit,
  disabled,
}: {
  settings: RunSettings;
  onChange: (next: RunSettings) => void;
  name: string;
  onNameChange: (v: string) => void;
  tag: string;
  onTagChange: (v: string) => void;
  keywordCount: number;
  uniqueCount: number;
  chunkSize: number;
  threshold: number;
  submitting: boolean;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const eta = formatDuration(estimateSeconds(uniqueCount, chunkSize));
  const background = uniqueCount > threshold;

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <h2 className="text-sm font-semibold text-text">Settings</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Defaults are set for US / English search. Ignore this panel if that suits.
          </p>
        </div>

        <Field label="Location" htmlFor="geo">
          <select
            id="geo"
            className={CONTROL}
            value={settings.geoTargetConstants[0] ?? ""}
            onChange={(e) => onChange({ ...settings, geoTargetConstants: [e.target.value] })}
          >
            {GEO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Language" htmlFor="lang">
          <select
            id="lang"
            className={CONTROL}
            value={settings.language ?? ""}
            onChange={(e) => onChange({ ...settings, language: e.target.value || null })}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Network" htmlFor="network" hint="Search partners usually inflate volume.">
          <select
            id="network"
            className={CONTROL}
            value={settings.network}
            onChange={(e) => onChange({ ...settings, network: e.target.value as RunSettings["network"] })}
          >
            <option value="GOOGLE_SEARCH">Google Search</option>
            <option value="GOOGLE_SEARCH_AND_PARTNERS">Google Search + partners</option>
          </select>
        </Field>

        <Field
          label="Volume history"
          hint="Affects the monthly volume series only — Google returns the same CPC whatever range you pick."
        >
          <SegmentedControl
            name="Volume history"
            value={String(settings.monthsBack)}
            onChange={(v) => onChange({ ...settings, monthsBack: Number(v) as RunSettings["monthsBack"] })}
            options={[
              { value: "3", label: "3 mo" },
              { value: "6", label: "6 mo" },
              { value: "12", label: "12 mo" },
            ]}
          />
        </Field>

        <Field
          label="Duplicates"
          hint={
            settings.dedupMode === "intact"
              ? "Every row you submitted comes back, in order, with metrics merged in."
              : "One row per keyword after Google collapses near-duplicates."
          }
        >
          <SegmentedControl
            name="Duplicates"
            value={settings.dedupMode}
            onChange={(v) => onChange({ ...settings, dedupMode: v as RunSettings["dedupMode"] })}
            options={[
              { value: "intact", label: "Keep my list intact" },
              { value: "deduped", label: "Deduped only" },
            ]}
          />
        </Field>

        <Field label="Run name" htmlFor="run-name">
          <input
            id="run-name"
            className={CONTROL}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Tag" htmlFor="run-tag" hint="Niche or site label, e.g. “ponly gardening”.">
          <input
            id="run-tag"
            className={CONTROL}
            value={tag}
            onChange={(e) => onTagChange(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>

      <div className="border-t border-border p-5">
        <div className="mb-3 flex items-baseline justify-between text-xs">
          <span className="text-text-secondary">
            {formatInt(uniqueCount)} unique
            {keywordCount !== uniqueCount && (
              <span className="text-text-muted"> of {formatInt(keywordCount)}</span>
            )}
          </span>
          {uniqueCount > 0 && <span className="num text-text-muted">~{eta}</span>}
        </div>

        <button type="button" onClick={onSubmit} disabled={disabled || submitting} className={`${BTN_PRIMARY} w-full`}>
          {submitting ? "Starting…" : background ? "Run in background" : "Run search"}
        </button>

        {uniqueCount > 0 && (
          <p className="mt-2 text-center text-xs text-text-muted">
            {background
              ? `Over ${formatInt(threshold)} keywords — this runs in the background.`
              : "Runs here on the page."}
          </p>
        )}
      </div>
    </div>
  );
}
