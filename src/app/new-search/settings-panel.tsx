"use client";

import type { ReactNode } from "react";
import { Clock, Play } from "lucide-react";
import { BTN_PRIMARY, CARD, CONTROL, Field, SegmentedControl } from "@/components/ui";
import { estimateSeconds, formatDuration, formatInt } from "@/lib/format";
import type { RunSettings } from "@/lib/types";

/**
 * Settings for a new search, laid out as a compact grid under the keyword
 * input. The fields, options and hints are the same as before; only the
 * layout changed. The count and Run button live in <RunBar> below.
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
}: {
  settings: RunSettings;
  onChange: (next: RunSettings) => void;
  name: string;
  onNameChange: (v: string) => void;
  tag: string;
  onTagChange: (v: string) => void;
}) {
  return (
    <div className={`${CARD} p-5`}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
        <h2 className="text-sm font-semibold text-text">Settings</h2>
        <p className="text-xs text-text-muted">
          Defaults are set for US / English search. Ignore this panel if that suits.
        </p>
      </div>

      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="sm:col-span-2">
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
        </div>

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
    </div>
  );
}

/**
 * The run bar: keyword count, time estimate and the Run button. It sticks to
 * the bottom of the screen while the form is on screen, so the primary action
 * is always in reach. `children` slots in the submit error (with Retry).
 */
export function RunBar({
  keywordCount,
  uniqueCount,
  chunkSize,
  threshold,
  submitting,
  onSubmit,
  disabled,
  children,
}: {
  keywordCount: number;
  uniqueCount: number;
  chunkSize: number;
  threshold: number;
  submitting: boolean;
  onSubmit: () => void;
  disabled: boolean;
  children?: ReactNode;
}) {
  const eta = formatDuration(estimateSeconds(uniqueCount, chunkSize));
  const background = uniqueCount > threshold;

  return (
    <div className="sticky bottom-0 z-20 -mx-2 px-2 pt-2 pb-4">
      {children}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border-strong bg-raised px-5 py-3 shadow-overlay">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="num text-sm text-text">
            <span className="text-base font-semibold">{formatInt(uniqueCount)}</span>{" "}
            <span className="text-text-secondary">unique</span>
            {keywordCount !== uniqueCount && (
              <span className="text-text-muted"> of {formatInt(keywordCount)}</span>
            )}
          </span>
          {uniqueCount > 0 && (
            <span className="num inline-flex items-center gap-1 text-xs text-text-muted">
              <Clock size={12} aria-hidden />~{eta}
            </span>
          )}
          {uniqueCount > 0 && (
            <span className="text-xs text-text-muted">
              {background
                ? `Over ${formatInt(threshold)} keywords — this runs in the background.`
                : "Runs here on the page."}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          className={`${BTN_PRIMARY} min-w-[180px]`}
        >
          <Play size={14} fill="currentColor" aria-hidden />
          {submitting ? "Starting…" : background ? "Run in background" : "Run search"}
        </button>
      </div>
    </div>
  );
}
