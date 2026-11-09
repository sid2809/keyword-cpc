"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ProgressBar, Skeleton } from "@/components/ui";
import { formatInt } from "@/lib/format";
import type { RunProgress } from "@/lib/types";

/**
 * Progress for a run that is still going — the same bar the New Search page
 * shows, per PLAN.md §3 ("the run ... shows the same progress bar there").
 * Refreshes the server component once the run finishes, so results appear
 * without a manual reload.
 */
export function LiveProgress({
  runId,
  initialProcessed,
  total,
}: {
  runId: string;
  initialProcessed: number;
  total: number;
}) {
  const router = useRouter();
  const [processed, setProcessed] = useState(initialProcessed);
  const [status, setStatus] = useState<RunProgress["status"]>("running");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}/progress`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as RunProgress;
          if (cancelled) return;
          setProcessed(json.processed);
          setStatus(json.status);
          if (json.status === "done" || json.status === "failed") {
            router.refresh();
            return;
          }
        }
      } catch {
        // Transient failure — keep polling rather than stranding the page.
      }
      timer = setTimeout(poll, 1000);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, router]);

  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">
            {status === "queued" ? "Queued…" : "Fetching keyword data…"}
          </h2>
          <span className="num text-sm font-medium text-text">{pct}%</span>
        </div>
        <p className="num mt-1 text-sm text-text-secondary">
          {formatInt(processed)} of {formatInt(total)} keywords
        </p>
        <div className="mt-4">
          <ProgressBar value={processed} max={total} />
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Google allows one request per second, so large lists take a little while. You can leave this
          page — the run continues, and it survives a server restart.
        </p>
      </Card>

      {/* Skeleton of the results that are about to appear, in their layout. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-24 w-full" />
      </Card>
      <Card className="space-y-2 p-5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </Card>
    </div>
  );
}
