"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/ui";
import { toast } from "@/components/toast";
import type { DedupMode } from "@/lib/types";

/** Column-selection modal before download — PLAN.md §6. */

const COLUMNS = [
  { key: "submitted", label: "Keyword" },
  { key: "canonical", label: "Canonical keyword" },
  { key: "lowTop", label: "Low top-of-page (₹)" },
  { key: "highTop", label: "High top-of-page (₹)" },
  { key: "avgCpc", label: "Avg CPC (₹, info)" },
  { key: "url", label: "URL" },
  { key: "volume", label: "Avg monthly searches" },
  { key: "competition", label: "Competition" },
  { key: "competitionIndex", label: "Competition index" },
  { key: "monthly", label: "Monthly volumes" },
  { key: "noData", label: "No-data flag" },
] as const;

const DEFAULTS = ["submitted", "lowTop", "highTop", "avgCpc", "volume", "competitionIndex"];

export function ExportModal({
  runId,
  mode,
  hasUpload,
  hasUrls,
  onClose,
  selection,
}: {
  runId: string;
  mode: DedupMode;
  hasUpload: boolean;
  /** Hides the URL option for runs that have none. */
  hasUrls: boolean;
  onClose: () => void;
  /** Row keys to export. Undefined exports every row. */
  selection?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(DEFAULTS);
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [downloading, setDownloading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectionCount = selection?.length ?? 0;

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

  /**
   * A selection goes by POST — a large one would exceed URL length limits as a
   * query string — so the response has to be turned into a download by hand.
   */
  async function downloadSelection() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, mode, columns: selected, selection }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status}).`);

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named ?? `keywords.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the click has definitely been handled.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
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
        className="dialog-in w-full max-w-md rounded-[var(--radius-card)] border border-border bg-raised shadow-overlay"
      >
        <div className="border-b border-border p-5">
          <h2 id="export-title" className="text-base font-semibold text-text">
            Export
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {selectionCount > 0
              ? `${selectionCount.toLocaleString("en-IN")} selected ${selectionCount === 1 ? "row" : "rows"}. `
              : ""}
            {mode === "intact"
              ? "Your original rows and order are preserved."
              : "One row per keyword after deduplication."}
            {hasUpload && mode === "intact" && " Your uploaded columns are re-attached."}
          </p>
        </div>

        <div className="space-y-5 p-5">
          <fieldset>
            <legend className="text-xs font-medium text-text-secondary">Columns</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {COLUMNS.filter((c) => c.key !== "url" || hasUrls).map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-text hover:bg-subtle"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(c.key)}
                    onChange={() => toggle(c.key)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-text-secondary">Format</legend>
            <div className="mt-2 flex gap-2">
              {(["xlsx", "csv"] as const).map((f) => (
                <label
                  key={f}
                  className={
                    "flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-medium " +
                    (format === f ? "border-accent bg-accent-soft text-text" : "border-border-strong text-text-secondary hover:bg-subtle")
                  }
                >
                  <input
                    type="radio"
                    name="format"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  {f.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-subtle/60 px-5 py-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          {selectionCount > 0 ? (
            <button
              type="button"
              disabled={selected.length === 0 || downloading}
              onClick={downloadSelection}
              className={BTN_PRIMARY}
            >
              <Download size={15} aria-hidden />
              {downloading ? "Preparing…" : `Download ${selectionCount.toLocaleString("en-IN")}`}
            </button>
          ) : (
            <a
              href={selected.length === 0 ? undefined : href}
              aria-disabled={selected.length === 0}
              onClick={() => {
                if (selected.length > 0) setTimeout(onClose, 300);
              }}
              className={`${BTN_PRIMARY} ${selected.length === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              <Download size={15} aria-hidden />
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
