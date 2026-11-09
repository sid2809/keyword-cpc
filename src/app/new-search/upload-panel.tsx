"use client";

import { useRef, useState } from "react";
import { CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { BTN_SECONDARY, CONTROL, Skeleton, btn } from "@/components/ui";
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
  /** -1 when nothing in the sheet looks like a URL column. */
  suggestedUrlColumn: number;
};

export function UploadPanel({
  sheet,
  onSheet,
  keywordColumn,
  onKeywordColumn,
  urlColumn,
  onUrlColumn,
}: {
  sheet: UploadedSheet | null;
  onSheet: (s: UploadedSheet | null) => void;
  keywordColumn: number;
  onKeywordColumn: (i: number) => void;
  /** -1 means "no URL column" — the feature stays entirely optional. */
  urlColumn: number;
  onUrlColumn: (i: number) => void;
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
      const parsed = json as UploadedSheet;
      onSheet(parsed);
      onKeywordColumn(parsed.suggestedColumn);
      onUrlColumn(parsed.suggestedUrlColumn ?? -1);
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
            "flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed p-10 text-center " +
            (dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface")
          }
        >
          <div
            className={
              "grid h-11 w-11 place-items-center rounded-full border border-border bg-surface " +
              (dragging ? "text-accent" : "text-text-secondary")
            }
            aria-hidden
          >
            {busy ? <FileSpreadsheet size={18} /> : <Upload size={18} />}
          </div>
          <p className="text-sm font-semibold text-text">
            {busy ? "Reading your file…" : "Drop a CSV or XLSX here"}
          </p>
          {busy ? (
            <div className="w-full max-w-xs space-y-2" aria-hidden>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              You&rsquo;ll pick which column holds the keywords next.
            </p>
          )}
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
            <p role="alert" className="flex items-center gap-2 text-sm text-heat-red">
              <CircleAlert size={15} className="shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-card">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent-soft text-accent" aria-hidden>
            <FileSpreadsheet size={17} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{sheet.filename}</p>
            <p className="num text-xs text-text-muted">
              {formatInt(sheet.totalRows)} rows · {sheet.columns.length} columns
              {!sheet.hasHeader && " · no header row detected"}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={btn("secondary", "sm")}
          onClick={() => {
            onSheet(null);
            setError(null);
          }}
        >
          Replace file
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kw-col" className="text-xs font-medium text-text-secondary">
            Which column has the keywords?
          </label>
          <select
            id="kw-col"
            className={`${CONTROL} w-full`}
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="url-col" className="text-xs font-medium text-text-secondary">
            URL column <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <select
            id="url-col"
            className={`${CONTROL} w-full`}
            value={urlColumn}
            onChange={(e) => onUrlColumn(Number(e.target.value))}
          >
            <option value={-1}>None</option>
            {sheet.columns.map((c, i) =>
              i === keywordColumn ? null : (
                <option key={`u-${c}-${i}`} value={i}>
                  {c}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr>
              {sheet.columns.map((c, i) => (
                <th
                  key={`${c}-${i}`}
                  className={
                    "whitespace-nowrap border-b border-border px-3 py-2.5 text-xs font-medium " +
                    (i === keywordColumn || i === urlColumn
                      ? "bg-accent-soft text-accent"
                      : "bg-subtle text-text-secondary")
                  }
                >
                  {c}
                  {i === keywordColumn && (
                    <span className="ml-1.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold uppercase text-on-accent">
                      keywords
                    </span>
                  )}
                  {i === urlColumn && (
                    <span className="ml-1.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold uppercase text-on-accent">
                      url
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.preview.map((row, r) => (
              <tr key={r} className="hover:bg-subtle">
                {sheet.columns.map((_, c) => (
                  <td
                    key={c}
                    className={
                      "max-w-[240px] truncate border-b border-border px-3 py-2 text-sm " +
                      (c === keywordColumn || c === urlColumn ? "text-text" : "text-text-secondary")
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
        {urlColumn >= 0 && " The URL column also appears in the results table."}
      </p>
    </div>
  );
}
