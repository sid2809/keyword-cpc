import Link from "next/link";
import { StatusBadge } from "./ui";
import { formatDateTime, formatMicros } from "@/lib/format";
import type { RunListItem } from "@/lib/types";

/** "Recent runs" strip below the workbench — PLAN.md §6 screen 1. */
export function RecentRuns({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text">Recent runs</h2>
        <Link href="/runs" className="text-xs font-medium text-accent hover:underline">
          All runs
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/runs/${run.id}`}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-3 hover:border-accent"
          >
            <p className="truncate text-sm font-medium text-text">
              {run.name ?? `Run ${run.id.slice(0, 8)}`}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {run.tag ?? formatDateTime(run.createdAt)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusBadge status={run.status} />
              <span className="num text-text" title="Volume-weighted high top-of-page bid">{formatMicros(run.weightedAvgHighTopMicros)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
