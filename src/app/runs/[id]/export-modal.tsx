"use client";

import { useEffect, useRef, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/ui";
import type { DedupMode } from "@/lib/types";

/** Column-selection modal before download — PLAN.md §6. */

const COLUMNS = [
  { key: "submitted", label: "Keyword" },
  { key: "canonical", label: "Canonical keyword" },
  { key: "avgCpc", label: "Avg CPC (₹)" },
  { key: "lowTop", label: "Low top-of-page (₹)" },
  { key: "highTop", label: "High top-of-page (₹)" },
  { key: "volume", label: "Avg monthly searches" },
  { key: "competition", label: "Competition" },
  { key: "competitionIndex", label: "Competition index" },
  { key: "monthly", label: "Monthly volumes" },
  { key: "noData", label: "No-data flag" },
] as const;

const DEFAULTS = ["submitted", "avgCpc", "lowTop", "highTop", "volume", "competitionIndex"];

export function ExportModal({
  runId,
  mode,
  hasUpload,
  onClose,
}: {
  runId: string;
  mode: DedupMode;
  hasUpload: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(DEFAULTS);
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the dialog so keyboard users aren't stranded.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(key: string) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  const href = `/api/runs/${runId}/export?format=${format}&mode=${mode}&columns=${selected.join(",")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5"
      >
        <h2 id="export-title" className="text-sm font-semibold text-text">
          Export
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {mode === "intact"
            ? "Your original rows and order are preserved."
            : "One row per keyword after deduplication."}
          {hasUpload && mode === "intact" && " Your uploaded columns are re-attached."}
        </p>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-text-secondary">Columns</legend>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  onChange={() => toggle(c.key)}
                  className="accent-[var(--accent)]"
                />
                <span className="truncate">{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-text-secondary">Format</legend>
          <div className="mt-2 flex gap-4">
            {(["xlsx", "csv"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="format"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="accent-[var(--accent)]"
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <a
            href={selected.length === 0 ? undefined : href}
            aria-disabled={selected.length === 0}
            onClick={() => {
              if (selected.length > 0) setTimeout(onClose, 300);
            }}
            className={`${BTN_PRIMARY} ${selected.length === 0 ? "pointer-events-none opacity-50" : ""}`}
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
