"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Globe, RefreshCw } from "lucide-react";
import { ProgressBar, Skeleton, btn } from "@/components/ui";
import { COUNTRIES } from "@/lib/countries";
import { GEO_SHORTLIST } from "@/lib/geo-shortlist";
import { formatDuration, formatInt } from "@/lib/format";

/**
 * "Refresh numbers" and "Country breakdown" for a project: the confirm dialog
 * (which first asks the server what the action would cost) and the refresh
 * progress strip. Server side: api/projects/[id]/refresh and .../geo.
 */

/** Selected entries, or everything matching the table's filters ("" = whole project). */
export type ActionTarget = { ids: string[] } | { filters: string };

export type ProjectJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  entries: number;
  requestsDone: number;
  requestsTotal: number;
  error: string | null;
};

type Scope = "shortlist" | "all";
type Preview =
  | { kind: "refresh"; entries: number; requests: number }
  | { kind: "geo"; keywords: number; shortlistRequests: number; allRequests: number };

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Request failed (${res.status}).`);
  return body;
}

export function ProjectActionDialog({
  projectId,
  kind,
  target,
  targetLabel,
  onClose,
  onStarted,
}: {
  projectId: string;
  kind: "refresh" | "geo";
  target: ActionTarget;
  /** e.g. "12 selected keywords", "keywords matching the filters", "the whole project". */
  targetLabel: string;
  onClose: () => void;
  onStarted: (kind: "refresh" | "geo", count: number) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [scope, setScope] = useState<Scope>("shortlist");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const url = `/api/projects/${projectId}/${kind}`;
  const targetKey = JSON.stringify(target);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ask the server what this would cost before anything starts.
  useEffect(() => {
    let cancelled = false;
    post<Omit<Preview, "kind">>(url, { ...JSON.parse(targetKey), dryRun: true })
      .then((body) => !cancelled && setPreview({ kind, ...body } as Preview))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [url, kind, targetKey]);

  const count = preview ? (preview.kind === "refresh" ? preview.entries : preview.keywords) : 0;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await post(url, kind === "geo" ? { ...target, scope } : target);
      onStarted(kind, count);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  const Icon = kind === "refresh" ? RefreshCw : Globe;
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
        aria-labelledby="project-action-title"
        className="dialog-in w-full max-w-md rounded-[var(--radius-card)] border border-border bg-raised shadow-overlay"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="project-action-title" className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon size={15} aria-hidden />
            {kind === "refresh" ? "Refresh numbers" : "Country breakdown"}
          </h2>
          <p className="mt-1 text-xs text-text-muted">For {targetLabel}.</p>
        </div>

        <div className="space-y-2 px-5 py-4" aria-live="polite">
          {!preview && !error && <Skeleton className="h-14 w-full" />}

          {preview?.kind === "refresh" && (
            <>
              <p className="num text-sm text-text" data-testid="action-cost">
                {formatInt(preview.entries)} {preview.entries === 1 ? "keyword" : "keywords"} ·{" "}
                {formatInt(preview.requests)} {preview.requests === 1 ? "request" : "requests"} · about{" "}
                {formatDuration(preview.requests)}
              </p>
              <p className="text-xs leading-5 text-text-muted">
                Each keyword is asked again with the settings it was saved with. The new numbers are stored as a new
                fetch; older fetches are kept. It runs in the background and shares the 1 request per second limit with
                searches.
              </p>
            </>
          )}

          {preview?.kind === "geo" && (
            <>
              <p className="num text-sm text-text" data-testid="action-cost">
                {formatInt(preview.keywords)} {preview.keywords === 1 ? "keyword" : "keywords"}
              </p>
              <div role="radiogroup" aria-label="Countries to scan" className="space-y-2">
                {(
                  [
                    { value: "shortlist", title: `${GEO_SHORTLIST.length} large markets`, requests: preview.shortlistRequests },
                    { value: "all", title: `All ${COUNTRIES.length} countries`, requests: preview.allRequests },
                  ] as const
                ).map((o) => {
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
                        name="project-geo-scope"
                        checked={checked}
                        onChange={() => setScope(o.value)}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-text">{o.title}</span>
                        <span className="num block text-xs text-text-secondary">
                          Up to {formatInt(o.requests)} requests · about {formatDuration(o.requests)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs leading-5 text-text-muted">
                Any language, each keyword&apos;s own network. Countries a keyword already has an answer for are
                skipped, so it can take fewer. It runs in the background.
              </p>
            </>
          )}

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
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || !preview || count === 0}
            className={btn("primary", "sm")}
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- refresh job ------------------------------------------------------------

const POLL_MS = 2000;

async function fetchJob(projectId: string): Promise<ProjectJob | null | undefined> {
  try {
    const res = await fetch(`/api/projects/${projectId}/refresh`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as { job: ProjectJob | null }).job : undefined;
  } catch {
    return undefined; // a missed poll is harmless
  }
}

/**
 * The project's refresh job, if one is active or just failed. Checks on mount
 * (so a reload picks it back up) and polls only while it is active.
 * `onFinished` fires once when an active job stops being active.
 */
export function useProjectJob(projectId: string, nonce: number, onFinished: () => void): ProjectJob | null {
  const [job, setJob] = useState<ProjectJob | null>(null);
  const active = job !== null && (job.status === "queued" || job.status === "running");
  const wasActive = useRef(false);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  useEffect(() => {
    let cancelled = false;
    fetchJob(projectId).then((next) => {
      if (cancelled || next === undefined) return;
      setJob(next);
      // A job just started here can finish before this first check sees it
      // running; its results still need showing.
      if (nonce > 0 && (next === null || next.status === "failed")) finished.current();
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      fetchJob(projectId).then((next) => next !== undefined && setJob(next));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, active]);

  useEffect(() => {
    if (wasActive.current && !active) finished.current();
    wasActive.current = active;
  }, [active]);

  return job;
}

export function RefreshStrip({ job }: { job: ProjectJob | null }) {
  if (!job) return null;
  const failed = job.status === "failed";
  return (
    <div className="fade-in flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5" aria-live="polite">
      <span className={"flex items-center gap-2 text-xs font-medium " + (failed ? "text-heat-red" : "text-text-secondary")}>
        {failed ? <CircleAlert size={13} aria-hidden /> : <RefreshCw size={13} aria-hidden />}
        Refreshing numbers · {formatInt(job.entries)} {job.entries === 1 ? "keyword" : "keywords"}
      </span>
      {failed ? (
        <span className="text-xs text-heat-red">
          Stopped at {job.requestsDone} of {job.requestsTotal} requests: {job.error ?? "unknown error"}
        </span>
      ) : (
        <>
          <span className="w-40">
            <ProgressBar value={job.requestsDone} max={job.requestsTotal} />
          </span>
          <span className="num text-xs text-text-secondary">
            {job.requestsDone} of {job.requestsTotal} requests
          </span>
        </>
      )}
    </div>
  );
}
