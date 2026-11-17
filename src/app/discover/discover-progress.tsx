"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, Card, ProgressBar } from "@/components/ui";
import { SEED_KIND_LABEL, seedLabel, type SeedInput } from "@/lib/discover-seeds";
import { formatInt } from "@/lib/format";
import type { RunProgress } from "@/lib/types";

/**
 * Progress of a discovery, seed by seed. Polls the run and its seeds; a seed's
 * line fills in as soon as its ideas are stored. Leaving the page is safe —
 * the discovery carries on and is in Runs.
 */

type Seed = SeedInput & {
  position: number;
  status: "pending" | "done" | "failed";
  ideasTotal: number | null;
  ideasKept: number;
  truncated: boolean;
  error: string | null;
};

export function DiscoverProgress({
  runId,
  seedCount,
  onOpen,
  onAnother,
}: {
  runId: string;
  seedCount: number;
  onOpen: () => void;
  onAnother: () => void;
}) {
  const [status, setStatus] = useState<RunProgress["status"]>("queued");
  const [runError, setRunError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const [p, s] = await Promise.all([
          fetch(`/api/runs/${runId}/progress`, { cache: "no-store" }),
          fetch(`/api/runs/${runId}/seeds`, { cache: "no-store" }),
        ]);
        if (!p.ok || !s.ok) throw new Error("poll failed");
        const progress = (await p.json()) as RunProgress;
        const list = ((await s.json()) as { seeds: Seed[] }).seeds;
        if (cancelled) return;
        setStatus(progress.status);
        setRunError(progress.error);
        setSeeds(list);
        setPollError(false);
        if (progress.status === "done" || progress.status === "failed" || progress.status === "canceled") return;
      } catch {
        if (cancelled) return;
        setPollError(true); // keep polling through a blip
      }
      timer = setTimeout(poll, 800);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const total = seeds.length || seedCount;
  const dealt = seeds.filter((s) => s.status !== "pending").length;
  const ideas = seeds.reduce((sum, s) => sum + s.ideasKept, 0);
  const done = status === "done";
  const failed = status === "failed";

  return (
    <Card className="overflow-hidden">
      <div className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={`flex items-center gap-2 text-sm font-semibold ${failed ? "text-heat-red" : "text-text"}`}>
            {failed && <CircleAlert size={16} aria-hidden />}
            {failed ? "The discovery stopped" : done ? "Discovery finished" : "Asking Google for keyword ideas…"}
          </h2>
          <span className="num text-sm text-text-secondary" aria-live="polite" data-testid="discover-progress-count">
            {formatInt(dealt)} of {formatInt(total)} {total === 1 ? "seed" : "seeds"} · {formatInt(ideas)}{" "}
            {ideas === 1 ? "idea" : "ideas"}
          </span>
        </div>
        <div className="mt-4">
          <ProgressBar value={dealt} max={total} />
        </div>

        {failed && runError && (
          <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-heat-red/30 bg-heat-red-soft p-3 text-sm text-heat-red">
            {runError}
          </p>
        )}
        {failed && (
          <p className="mt-2 text-sm text-text-secondary">
            Seeds already answered are kept. Open the run to resume with the ones that are left.
          </p>
        )}
        {pollError && !done && !failed && <p className="mt-3 text-xs text-text-muted">Lost contact. Retrying…</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onOpen} className={done ? BTN_PRIMARY : BTN_SECONDARY}>
            {done ? "Open results" : failed ? "Open the run" : "View in Runs"}
          </button>
          <button type="button" onClick={onAnother} className={BTN_SECONDARY}>
            Start another discovery
          </button>
        </div>
        {!done && !failed && (
          <p className="mt-3 text-xs text-text-muted">
            You can leave this page. The discovery continues, and it survives a server restart.
          </p>
        )}
      </div>

      {seeds.length > 0 && (
        <ul className="divide-y divide-border border-t border-border" data-testid="discover-seeds">
          {seeds.map((s) => (
            <li key={s.position} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2">
              <span className="shrink-0" aria-hidden>
                {s.status === "done" ? (
                  <Check size={15} className="text-heat-green" />
                ) : s.status === "failed" ? (
                  <CircleAlert size={15} className="text-heat-red" />
                ) : (
                  <CircleDashed size={15} className="text-text-muted" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text" title={seedLabel(s)}>
                {seedLabel(s)}
              </span>
              <span className="text-xs text-text-muted">{SEED_KIND_LABEL[s.kind]}</span>
              <span className={"num w-56 text-right text-xs " + (s.status === "failed" ? "text-heat-red" : "text-text-secondary")}>
                {s.status === "pending"
                  ? "Waiting"
                  : s.status === "failed"
                    ? `Google rejected it: ${s.error ?? "no reason given"}`
                    : s.truncated
                      ? `${formatInt(s.ideasKept)} of ${formatInt(s.ideasTotal ?? s.ideasKept)} ideas (limit)`
                      : `${formatInt(s.ideasKept)} ${s.ideasKept === 1 ? "idea" : "ideas"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
