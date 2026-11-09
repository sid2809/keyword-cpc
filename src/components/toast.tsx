"use client";

import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

/**
 * Toasts: short messages in the bottom-right corner that dismiss themselves.
 *
 * Call `toast.success("…")` / `toast.error("…")` from any client component;
 * <Toaster /> is mounted once in the root layout. No provider — a tiny module
 * store read through useSyncExternalStore, the same pattern the theme toggle
 * uses.
 *
 * Only for transient confirmations and errors. Messages that carry an action
 * (Retry) or must stay visible remain inline next to what they describe.
 */

type Kind = "success" | "error";
type Toast = { id: number; kind: Kind; message: string };

/** Errors stay longer: they are more likely to need reading twice. */
const DURATION_MS: Record<Kind, number> = { success: 4000, error: 8000 };
/** Older toasts are dropped beyond this, so a burst cannot fill the screen. */
const MAX_VISIBLE = 4;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: Toast[] = [];

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: Kind, message: string) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => dismiss(id), DURATION_MS[kind]);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );

  return (
    // The container is a persistent live region: screen readers only announce
    // polite updates reliably in a region that existed before the update.
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          // Errors interrupt; confirmations are read by the polite region.
          role={t.kind === "error" ? "alert" : undefined}
          className="toast-in pointer-events-auto flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-raised p-3 shadow-overlay"
        >
          {t.kind === "success" ? (
            <CircleCheck size={16} className="mt-0.5 shrink-0 text-heat-green" aria-hidden />
          ) : (
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-heat-red" aria-hidden />
          )}
          <p className="min-w-0 flex-1 text-sm text-text">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="-m-1 rounded-[4px] p-1 text-text-muted hover:bg-subtle hover:text-text"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
