import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { CARD, StatusBadge } from "./ui";
import { formatDateTime, formatMicros } from "@/lib/format";
import type { RunListItem } from "@/lib/types";

/** "Recent runs" strip below the workbench — PLAN.md §6 screen 1. */
export function RecentRuns({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text">Recent runs</h2>
        <Link href="/runs" className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text">
          All runs
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/runs/${run.id}`}
            className={`${CARD} flex flex-col p-4 hover:border-border-strong hover:bg-subtle/50`}
          >
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-text">
              {run.savedForever && (
                <Star size={13} className="shrink-0 text-heat-amber" fill="currentColor" aria-label="Saved forever" />
              )}
              <span className="truncate">{run.name ?? `Run ${run.id.slice(0, 8)}`}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {run.tag ?? formatDateTime(run.createdAt)}
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
              <StatusBadge status={run.status} />
              <span className="num font-medium text-text" title="Volume-weighted high top-of-page bid">{formatMicros(run.weightedAvgHighTopMicros)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
