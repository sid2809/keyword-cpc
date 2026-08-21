"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BTN_SECONDARY } from "@/components/ui";
import { removeRun, startRefresh, toggleSavedForever } from "@/app/actions";

/** Save-forever star, refresh and delete — PLAN.md §6 screen 2 and §4. */
export function RunActions({
  runId,
  savedForever,
  canRefresh,
  refreshedAt,
}: {
  runId: string;
  savedForever: boolean;
  canRefresh: boolean;
  refreshedAt: string | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(savedForever);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onStar() {
    const next = !saved;
    setSaved(next); // optimistic — the star should feel instant
    startTransition(async () => {
      try {
        await toggleSavedForever(runId, next);
      } catch {
        setSaved(!next);
        setError("Could not update this run.");
      }
    });
  }

  function onRefresh() {
    setError(null);
    startTransition(async () => {
      try {
        await startRefresh(runId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the refresh.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onStar}
        disabled={pending}
        aria-pressed={saved}
        title={saved ? "Saved forever — exempt from cleanup" : "Save this run forever"}
        className={`${BTN_SECONDARY} ${saved ? "text-heat-amber" : ""}`}
      >
        <span aria-hidden>{saved ? "★" : "☆"}</span>
        {saved ? "Saved" : "Save forever"}
      </button>

      <button
        type="button"
        onClick={onRefresh}
        disabled={pending || !canRefresh}
        title={
          canRefresh
            ? "Re-pull from Google, bypassing the cache, and show what moved"
            : "Wait for the run to finish first"
        }
        className={BTN_SECONDARY}
      >
        Refresh
      </button>

      {confirming ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-text-secondary">Delete this run?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => { await removeRun(runId); })}
            className={`${BTN_SECONDARY} text-heat-red`}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={BTN_SECONDARY}>
          Delete
        </button>
      )}

      {refreshedAt && (
        <span className="text-xs text-text-muted">
          Refreshed {new Date(refreshedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-heat-red">
          {error}
        </span>
      )}
    </div>
  );
}
