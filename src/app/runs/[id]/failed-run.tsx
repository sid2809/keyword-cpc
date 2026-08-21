"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BTN_PRIMARY, Card } from "@/components/ui";
import { formatInt } from "@/lib/format";
import { resumeRun } from "@/app/actions";

/**
 * A failed run is recoverable — chunk_cursor is still where it stopped, so
 * resuming continues rather than restarting. Phase 5 makes that a button
 * instead of a CLI instruction.
 */
export function FailedRun({
  runId,
  processed,
  total,
  error,
}: {
  runId: string;
  processed: number;
  total: number;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-heat-red">This run stopped</h2>
      <p className="mt-1 text-sm text-text-secondary">
        It got through {formatInt(processed)} of {formatInt(total)} keywords. Nothing is lost —
        resuming continues from that point rather than starting over, and the keywords already
        fetched are not charged against your quota again.
      </p>

      {error && (
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] border border-border p-3 text-xs text-text-secondary">
          {error}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={BTN_PRIMARY}
          onClick={() =>
            startTransition(async () => {
              setFailed(null);
              try {
                await resumeRun(runId);
                router.refresh();
              } catch (err) {
                setFailed(err instanceof Error ? err.message : "Could not resume this run.");
              }
            })
          }
        >
          {pending ? "Resuming…" : "Resume this run"}
        </button>
        {failed && (
          <span role="alert" className="text-sm text-heat-red">
            {failed}
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Or from a terminal: <span className="num">npm run run:keywords -- --resume {runId}</span>
      </p>
    </Card>
  );
}
