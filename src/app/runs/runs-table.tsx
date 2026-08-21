"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BTN_PRIMARY, BTN_SECONDARY, ProgressBar, StatusBadge } from "@/components/ui";
import { formatDateTime, formatInt, formatMicros } from "@/lib/format";
import type { RunListItem } from "@/lib/types";

/**
 * Runs table with two-run selection for compare (PLAN.md §6 screen 3).
 * Only finished runs can be picked — an in-flight run has partial metrics.
 */
export function RunsTable({ runs }: { runs: RunListItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      // Keep the two most recent picks, dropping the oldest.
      return s.length < 2 ? [...s, id] : [s[1], id];
    });
  }

  const comparable = runs.filter((r) => r.status === "done").length >= 2;

  return (
    <>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-accent-soft px-4 py-2.5">
          <span className="text-sm text-text">
            {selected.length === 1
              ? "Pick one more run to compare."
              : "Two runs selected — compare them side by side."}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setSelected([])} className={BTN_SECONDARY}>
              Clear
            </button>
            <button
              type="button"
              disabled={selected.length !== 2}
              onClick={() => router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)}
              className={BTN_PRIMARY}
            >
              Compare
            </button>
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 px-4 py-2">
                <span className="sr-only">Select for comparison</span>
              </th>
              <th className="px-4 py-2 text-xs font-medium text-text-secondary">Name</th>
              <th className="px-4 py-2 text-xs font-medium text-text-secondary">Tag</th>
              <th className="px-4 py-2 text-xs font-medium text-text-secondary">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Keywords</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Wtd top-of-page</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const selectable = run.status === "done";
              return (
                <tr key={run.id} className="border-b border-border last:border-0 hover:bg-accent-soft/40">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(run.id)}
                      onChange={() => toggle(run.id)}
                      disabled={!selectable}
                      aria-label={`Select ${run.name ?? run.id.slice(0, 8)} for comparison`}
                      title={selectable ? "Select for comparison" : "Only finished runs can be compared"}
                      className="accent-[var(--accent)] disabled:opacity-30"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/runs/${run.id}`} className="text-sm font-medium text-text hover:text-accent">
                      {run.savedForever && (
                        <span className="mr-1.5 text-heat-amber" title="Saved forever" aria-label="Saved forever">
                          ★
                        </span>
                      )}
                      {run.name ?? `Run ${run.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-sm text-text-secondary">{run.tag ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={run.status} />
                    {(run.status === "running" || run.status === "queued") && (
                      <div className="mt-1 w-24">
                        <ProgressBar value={run.processed} max={run.total} />
                      </div>
                    )}
                  </td>
                  <td className="num px-4 py-2 text-right text-text">{formatInt(run.total)}</td>
                  <td className="num px-4 py-2 text-right text-text">
                    {formatMicros(run.weightedAvgHighTopMicros)}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-text-muted">
                    {formatDateTime(run.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!comparable && runs.length > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          Comparison needs two finished runs.
        </p>
      )}
    </>
  );
}
