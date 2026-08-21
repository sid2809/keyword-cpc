"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsPanel } from "./settings-panel";
import { UploadPanel, type UploadedSheet } from "./upload-panel";
import { RunProgress } from "./run-progress";
import { formatInt } from "@/lib/format";
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
  const [settings, setSettings] = useState<RunSettings>(defaultSettings);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<{ id: string; total: number } | null>(null);

  // Same normalisation the server applies, so the live count is honest.
  const keywords = useMemo(() => {
    const raw =
      tab === "paste"
        ? text.split(/[\n\r,]+/)
        : (sheet?.rows ?? []).map((r) => r[keywordColumn] ?? "");
    return raw.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 0);
  }, [tab, text, sheet, keywordColumn]);

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
          keywords,
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
    <div className="flex flex-col gap-4 min-[900px]:flex-row">
      {/* LEFT ~60% */}
      <section className="flex min-h-[420px] flex-col min-[900px]:w-[60%]">
        <div className="mb-3 flex gap-1" role="tablist" aria-label="Keyword source">
          {(["paste", "upload"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={
                "rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium capitalize " +
                (tab === t ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-accent")
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "paste" ? (
          <div className="flex flex-1 flex-col">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={"gardening tools\nraised garden bed\nlawn mower"}
              aria-label="Keywords"
              className="min-h-[320px] flex-1 resize-y rounded-[var(--radius-card)] border border-border bg-surface p-4 font-mono text-[13px] leading-6 text-text placeholder:text-text-muted"
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
            />
          </div>
        )}
      </section>

      {/* RIGHT ~40% */}
      <aside className="min-[900px]:w-[40%]">
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          name={name}
          onNameChange={setName}
          tag={tag}
          onTagChange={setTag}
          keywordCount={keywords.length}
          uniqueCount={uniqueCount}
          chunkSize={chunkSize}
          threshold={threshold}
          submitting={submitting}
          onSubmit={submit}
          disabled={uniqueCount === 0}
        />
        {error && (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2"
          >
            <span className="text-sm text-heat-red">{error}</span>
            <button type="button" onClick={submit} className="text-sm font-medium text-accent hover:underline">
              Retry
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
