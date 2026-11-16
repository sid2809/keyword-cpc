"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Globe } from "lucide-react";
import { ProgressBar, btn } from "@/components/ui";
import { COUNTRIES } from "@/lib/countries";
import { GEO_SHORTLIST } from "@/lib/geo-shortlist";
import { formatDuration, formatInt } from "@/lib/format";
import type { RunSettings } from "@/lib/types";

/**
 * Bulk country breakdown for selected rows, plus the pieces the results page
 * needs around it: the jobs strip and the "already has a breakdown" lookup.
 * Server side: api/runs/[id]/geo, api/geo/jobs, api/geo/coverage.
 */

/** Keywords per request; keep equal to CHUNK_SIZE in lib/runner.ts. */
const KEYWORDS_PER_REQUEST = 5_000;

type Scope = "shortlist" | "all";

export type GeoJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  scope: Scope;
  keywords: number;
  done: number;
  total: number;
  error: string | null;
};

// --- dialog -----------------------------------------------------------------

export function GeoBulkDialog({
  runId,
  selection,
  onClose,
  onStarted,
}: {
  runId: string;
  /** Row keys of the selected rows. */
  selection: string[];
  onClose: () => void;
  onStarted: (keywords: number) => void;
}) {
  const [scope, setScope] = useState<Scope>("shortlist");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const perCountry = Math.ceil(selection.length / KEYWORDS_PER_REQUEST);
  const options: { value: Scope; title: string; countries: number }[] = [
    { value: "shortlist", title: `${GEO_SHORTLIST.length} large markets`, countries: GEO_SHORTLIST.length },
    { value: "all", title: `All ${COUNTRIES.length} countries`, countries: COUNTRIES.length },
  ];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/geo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, scope }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; keywords?: number } | null;
      if (!res.ok) throw new Error(body?.error ?? `Could not start the breakdown (${res.status}).`);
      onStarted(body?.keywords ?? selection.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="geo-bulk-title"
        className="dialog-in w-full max-w-md rounded-[var(--radius-card)] border border-border bg-raised shadow-overlay"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="geo-bulk-title" className="flex items-center gap-2 text-sm font-semibold text-text">
            <Globe size={15} aria-hidden />
            Country breakdown for {formatInt(selection.length)} selected {selection.length === 1 ? "row" : "rows"}
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Google is asked once per country for all of them together. Any language, this run&apos;s network.
          </p>
        </div>

        <div role="radiogroup" aria-label="Countries to scan" className="space-y-2 px-5 py-4">
          {options.map((o) => {
            const requests = o.countries * perCountry;
            const checked = scope === o.value;
            return (
              <label
                key={o.value}
                className={
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 " +
                  (checked ? "border-accent bg-accent-soft" : "border-border hover:bg-subtle")
                }
              >
                <input
                  type="radio"
                  name="geo-scope"
                  checked={checked}
                  onChange={() => setScope(o.value)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-text">{o.title}</span>
                  <span className="num block text-xs text-text-secondary">
                    Up to {formatInt(requests)} requests · about {formatDuration(requests)}
                  </span>
                </span>
              </label>
            );
          })}
          <p className="text-xs leading-5 text-text-muted">
            Countries already scanned this month are skipped, so it can take fewer. It runs in the background and
            shares the 1 request per second limit with searches.
          </p>
          {error && (
            <p role="alert" className="fade-in flex items-center gap-2 text-xs text-heat-red">
              <CircleAlert size={13} aria-hidden />
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className={btn("secondary", "sm")}>
            Cancel
          </button>
          <button type="button" onClick={() => void start()} disabled={starting} className={btn("primary", "sm")}>
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- jobs strip -------------------------------------------------------------

const JOBS_POLL_MS = 2000;

/**
 * Breakdown jobs in progress. Checks once on mount (so a reload picks a
 * running job back up) and polls only while something is active. `nonce`
 * forces a re-check, e.g. right after starting a job.
 */
export function useGeoJobs(nonce: number): GeoJob[] {
  const [jobs, setJobs] = useState<GeoJob[]>([]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    let cancelled = false;
    fetchGeoJobs().then((next) => {
      if (!cancelled && next) setJobs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      fetchGeoJobs().then((next) => next && setJobs(next));
    }, JOBS_POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return jobs;
}

/** null when the request failed; a missed poll is harmless, the next catches up. */
async function fetchGeoJobs(): Promise<GeoJob[] | null> {
  try {
    const res = await fetch("/api/geo/jobs", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { jobs: GeoJob[] }).jobs : null;
  } catch {
    return null;
  }
}

export function GeoJobsStrip({ jobs }: { jobs: GeoJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <div className="border-b border-border">
      {jobs.map((j) => {
        const failed = j.status === "failed";
        return (
          <div key={j.id} className="fade-in flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5" aria-live="polite">
            <span className={"flex items-center gap-2 text-xs font-medium " + (failed ? "text-heat-red" : "text-text-secondary")}>
              {failed ? <CircleAlert size={13} aria-hidden /> : <Globe size={13} aria-hidden />}
              Country breakdown · {formatInt(j.keywords)} {j.keywords === 1 ? "keyword" : "keywords"}
            </span>
            {failed ? (
              <span className="text-xs text-heat-red">
                Stopped at {j.done} of {j.total} countries: {j.error ?? "unknown error"}
              </span>
            ) : (
              <>
                <span className="w-40">
                  <ProgressBar value={j.done} max={j.total} />
                </span>
                <span className="num text-xs text-text-secondary">
                  {j.done} of {j.total} countries
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- which rows already have a breakdown ------------------------------------

/**
 * Countries scanned this month for each of the given keywords (lower-cased).
 * Re-fetched when the keywords change and whenever `refreshKey` changes.
 */
export function useGeoCoverage(
  keywords: string[],
  network: RunSettings["network"],
  refreshKey: string | number,
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const listKey = keywords.join("\n");

  useEffect(() => {
    if (listKey === "") return;
    let cancelled = false;
    fetch("/api/geo/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: listKey.split("\n"), network }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ counts: Record<string, number> }>) : null))
      .then((body) => {
        if (!cancelled && body) setCounts(body.counts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listKey, network, refreshKey]);

  return counts;
}
