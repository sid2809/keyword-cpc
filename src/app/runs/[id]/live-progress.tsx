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

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text">
          {status === "queued" ? "Queued…" : "Fetching keyword data…"}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
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

      {/* Skeleton of the results that are about to appear. */}
      <Card className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
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
