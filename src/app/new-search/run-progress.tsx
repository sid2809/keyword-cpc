"use client";

import { useEffect, useState } from "react";
import { BTN_SECONDARY, Card, ProgressBar } from "@/components/ui";
import { formatInt } from "@/lib/format";
import type { RunProgress as Progress } from "@/lib/types";

/**
 * Inline progress for a live-mode run. Polling rather than SSE — the plan says
 * polling is fine, and a single user polling one row by primary key is cheap.
 */
export function RunProgress({
  runId,
  total,
  onDone,
  onCancel,
}: {
  runId: string;
  total: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}/progress`, { cache: "no-store" });
        if (!res.ok) throw new Error("Lost contact with the run.");
        const json = (await res.json()) as Progress;
        if (cancelled) return;

        setProgress(json);
        setPollError(null);

        if (json.status === "done") {
          onDone();
          return;
        }
        if (json.status === "failed" || json.status === "canceled") return;
      } catch (err) {
        if (cancelled) return;
        // Keep polling through a transient blip rather than giving up.
        setPollError(err instanceof Error ? err.message : "Lost contact with the run.");
      }
      timer = setTimeout(poll, 700);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, onDone]);

  const processed = progress?.processed ?? 0;
  const max = progress?.total || total;
  const failed = progress?.status === "failed";

  return (
    <Card className="p-6">
      <div className="mx-auto max-w-md">
        <h2 className="text-sm font-semibold text-text">
          {failed ? "The run stopped" : "Fetching keyword data…"}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {failed
            ? "Nothing is lost — it resumes from where it stopped."
            : `${formatInt(processed)} of ${formatInt(max)} keywords`}
        </p>

        <div className="mt-4">
          <ProgressBar value={processed} max={max} />
        </div>

        {failed && progress?.error && (
          <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-border p-3 text-sm text-heat-red">
            {progress.error}
          </p>
        )}
        {pollError && !failed && <p className="mt-3 text-xs text-text-muted">{pollError} Retrying…</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onDone} className={BTN_SECONDARY}>
            {failed ? "Open the run" : "View in Runs"}
          </button>
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            Start another search
          </button>
        </div>
      </div>
    </Card>
  );
}
