"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RunBar, SettingsPanel } from "./settings-panel";
import { UploadPanel, type UploadedSheet } from "./upload-panel";
import { RunProgress } from "./run-progress";
import { CircleAlert, ClipboardList, Upload } from "lucide-react";
import { formatInt } from "@/lib/format";
import { btn } from "@/components/ui";
import type { RunSettings } from "@/lib/types";

/**
 * New Search workbench — PLAN.md §6 screen 1.
 * Left panel ~60% (Paste | Upload tabs), right panel ~40% (settings card).
 * Stacks vertically below 900px.
 */

type Tab = "paste" | "upload";

export function Workbench({
  defaultSettings,
  threshold,
  chunkSize,
}: {
  defaultSettings: RunSettings;
  threshold: number;
  chunkSize: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<UploadedSheet | null>(null);
  const [keywordColumn, setKeywordColumn] = useState(0);
  // -1 = no URL column. Optional throughout; pasted runs never have one.
  const [urlColumn, setUrlColumn] = useState(-1);
  const [settings, setSettings] = useState<RunSettings>(defaultSettings);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<{ id: string; total: number } | null>(null);

  /*
   * The keyword column is sent to the server UNFILTERED, blanks included: the
   * array index becomes run_keywords.source_row, which is how the export and
   * the URL column find the right sheet row. Stripping blanks here would put
   * every keyword after a gap on the wrong row.
   */
  const submittedValues = useMemo(
    () =>
      tab === "paste"
        ? text.split(/[\n\r,]+/).map((s) => s.replace(/\s+/g, " ").trim())
        : (sheet?.rows ?? []).map((r) => (r[keywordColumn] ?? "").replace(/\s+/g, " ").trim()),
    [tab, text, sheet, keywordColumn],
  );

  // The visible count is of real keywords, so blanks are excluded here.
  const keywords = useMemo(() => submittedValues.filter((s) => s.length > 0), [submittedValues]);

  const uniqueCount = useMemo(
    () => new Set(keywords.map((k) => k.toLowerCase())).size,
    [keywords],
  );

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: submittedValues,
          name,
          tag,
          settings,
          source: tab === "paste" ? "paste" : sheet?.filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
          upload:
            tab === "upload" && sheet
              ? {
                  filename: sheet.filename,
                  columns: sheet.columns,
                  rows: sheet.rows,
                  keywordColumn,
                  urlColumn: urlColumn >= 0 ? urlColumn : null,
                  hasHeader: sheet.hasHeader,
                }
              : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start the run.");

      // Over the threshold the run is a background job — go straight to its page.
      // Under it, stay here and show progress inline, as the plan specifies.
      if (json.unique > threshold) {
        router.push(`/runs/${json.id}`);
      } else {
        setActiveRun({ id: json.id, total: json.unique });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the run.");
    } finally {
      setSubmitting(false);
    }
  }

  if (activeRun) {
    return (
      <RunProgress
        runId={activeRun.id}
        total={activeRun.total}
        onDone={() => router.push(`/runs/${activeRun.id}`)}
        onCancel={() => setActiveRun(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Keywords — full width */}
      <section className="flex flex-col">
        <div
          className="mb-3 inline-flex self-start rounded-[var(--radius-control)] border border-border bg-subtle p-0.5"
          role="tablist"
          aria-label="Keyword source"
        >
          {(["paste", "upload"] as Tab[]).map((t) => {
            const Icon = t === "paste" ? ClipboardList : Upload;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={
                  "inline-flex items-center gap-2 rounded-[4px] px-3 py-1.5 text-sm font-medium capitalize " +
                  (tab === t
                    ? "bg-surface text-text shadow-card ring-1 ring-border"
                    : "text-text-secondary hover:text-text")
                }
              >
                <Icon size={15} className={tab === t ? "text-accent" : ""} aria-hidden />
                {t}
              </button>
            );
          })}
        </div>

        {tab === "paste" ? (
          <div className="flex flex-1 flex-col">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={"gardening tools\nraised garden bed\nlawn mower"}
              aria-label="Keywords"
              className="min-h-[240px] flex-1 resize-y rounded-[var(--radius-card)] border border-border-strong bg-surface p-4 font-mono text-[13px] leading-6 text-text shadow-card placeholder:text-text-muted hover:border-text-muted/50"
            />
            <p className="mt-2 text-xs text-text-muted">
              One keyword per line, or comma separated. Up to {formatInt(threshold)} runs instantly;
              larger runs go to the background — you&rsquo;ll see progress either way.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <UploadPanel
              sheet={sheet}
              onSheet={setSheet}
              keywordColumn={keywordColumn}
              onKeywordColumn={setKeywordColumn}
              urlColumn={urlColumn}
              onUrlColumn={setUrlColumn}
            />
          </div>
        )}
      </section>

      {/* Settings — compact grid */}
      <SettingsPanel
        settings={settings}
        onChange={setSettings}
        name={name}
        onNameChange={setName}
        tag={tag}
        onTagChange={setTag}
      />

      {/* Count + Run — sticky at the bottom while the form is on screen */}
      <RunBar
        keywordCount={keywords.length}
        uniqueCount={uniqueCount}
        chunkSize={chunkSize}
        threshold={threshold}
        submitting={submitting}
        onSubmit={submit}
        disabled={uniqueCount === 0}
      >
        {error && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-heat-red/30 bg-heat-red-soft px-3 py-2"
          >
            <span className="flex items-center gap-2 text-sm text-heat-red">
              <CircleAlert size={15} className="shrink-0" aria-hidden />
              {error}
            </span>
            <button type="button" onClick={submit} className={btn("secondary", "xs")}>
              Retry
            </button>
          </div>
        )}
      </RunBar>
    </div>
  );
}
