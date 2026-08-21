"use client";

import { useRef, useState } from "react";
import { BTN_SECONDARY } from "@/components/ui";
import { formatInt } from "@/lib/format";

/**
 * Upload tab (PLAN.md §6): drag-drop CSV/XLSX → column picker → preview of the
 * first ten rows.
 */

export type UploadedSheet = {
  filename: string;
  columns: string[];
  rows: string[][];
  preview: string[][];
  totalRows: number;
  hasHeader: boolean;
  suggestedColumn: number;
};

export function UploadPanel({
  sheet,
  onSheet,
  keywordColumn,
  onKeywordColumn,
}: {
  sheet: UploadedSheet | null;
  onSheet: (s: UploadedSheet | null) => void;
  keywordColumn: number;
  onKeywordColumn: (i: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      onSheet(json as UploadedSheet);
      onKeywordColumn((json as UploadedSheet).suggestedColumn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      onSheet(null);
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) {
    return (
      <div className="flex h-full flex-col">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          className={
            "flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed p-10 text-center " +
            (dragging ? "border-accent bg-accent-soft" : "border-border")
          }
        >
          <p className="text-sm font-medium text-text">
            {busy ? "Reading your file…" : "Drop a CSV or XLSX here"}
          </p>
          <p className="text-sm text-text-secondary">
            You&rsquo;ll pick which column holds the keywords next.
          </p>
          <button type="button" className={BTN_SECONDARY} onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose a file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-heat-red">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{sheet.filename}</p>
          <p className="text-xs text-text-muted">
            {formatInt(sheet.totalRows)} rows · {sheet.columns.length} columns
            {!sheet.hasHeader && " · no header row detected"}
          </p>
        </div>
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() => {
            onSheet(null);
            setError(null);
          }}
        >
          Replace file
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="kw-col" className="text-xs font-medium text-text-secondary">
          Which column has the keywords?
        </label>
        <select
          id="kw-col"
          className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text"
          value={keywordColumn}
          onChange={(e) => onKeywordColumn(Number(e.target.value))}
        >
          {sheet.columns.map((c, i) => (
            <option key={`${c}-${i}`} value={i}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {sheet.columns.map((c, i) => (
                <th
                  key={`${c}-${i}`}
                  className={
                    "whitespace-nowrap border-b border-border px-3 py-2 text-xs font-medium " +
                    (i === keywordColumn ? "bg-accent-soft text-accent" : "text-text-secondary")
                  }
                >
                  {c}
                  {i === keywordColumn && <span className="ml-1.5 text-[10px] uppercase">keywords</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.preview.map((row, r) => (
              <tr key={r} className="hover:bg-accent-soft/40">
                {sheet.columns.map((_, c) => (
                  <td
                    key={c}
                    className={
                      "max-w-[240px] truncate border-b border-border px-3 py-1.5 text-sm " +
                      (c === keywordColumn ? "text-text" : "text-text-secondary")
                    }
                  >
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        Showing the first {Math.min(sheet.preview.length, sheet.totalRows)} rows. Your other columns are
        kept and re-attached when you export.
      </p>
    </div>
  );
}
