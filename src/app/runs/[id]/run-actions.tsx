"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Star, Trash2 } from "lucide-react";
import { BTN_SECONDARY, btn } from "@/components/ui";
import { toast } from "@/components/toast";
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
  const [pending, startTransition] = useTransition();

  function onStar() {
    const next = !saved;
    setSaved(next); // optimistic — the star should feel instant
    startTransition(async () => {
      try {
        await toggleSavedForever(runId, next);
      } catch {
        setSaved(!next);
        toast.error("Could not update this run.");
      }
    });
  }

  function onRefresh() {
    startTransition(async () => {
      try {
        await startRefresh(runId);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start the refresh.");
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
        <Star size={15} fill={saved ? "currentColor" : "none"} aria-hidden />
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
        <RefreshCw size={15} aria-hidden />
        Refresh
      </button>

      {confirming ? (
        <span className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-heat-red/30 bg-heat-red-soft py-1 pr-1 pl-3">
          <span className="text-xs font-medium text-heat-red">Delete this run?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => { await removeRun(runId); })}
            className={`${btn("secondary", "xs")} text-heat-red`}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={btn("secondary", "xs")}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={BTN_SECONDARY}>
          <Trash2 size={15} aria-hidden />
          Delete
        </button>
      )}

      {refreshedAt && (
        <span className="text-xs text-text-muted">
          Refreshed {new Date(refreshedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
