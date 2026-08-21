import type { ReactNode } from "react";

/**
 * Shared primitives so the §5 design system is expressed once.
 * Flat design: 0.5–1px borders, no shadows, no gradients, 150ms transitions.
 */

export const CONTROL =
  "h-9 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text " +
  "placeholder:text-text-muted disabled:opacity-60";

export const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 h-9 " +
  "text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";

export const BTN_PRIMARY = `${BTN_BASE} bg-accent text-on-accent hover:bg-accent-hover`;
export const BTN_SECONDARY = `${BTN_BASE} border border-border bg-surface text-text hover:bg-accent-soft hover:text-accent`;
export const BTN_GHOST = `${BTN_BASE} text-text-secondary hover:bg-accent-soft hover:text-accent`;

export const CARD = "rounded-[var(--radius-card)] border border-border bg-surface";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${CARD} ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** Segmented control — used for date-range presets and the dedup toggle. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={
              "rounded-[6px] px-3 py-1 text-xs font-medium " +
              (active ? "bg-accent text-on-accent" : "text-text-secondary hover:text-accent")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="max-w-sm text-sm text-text-secondary">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[6px] bg-border ${className}`} aria-hidden />;
}

const STATUS_STYLES: Record<string, string> = {
  done: "text-heat-green",
  running: "text-accent",
  queued: "text-text-secondary",
  failed: "text-heat-red",
  canceled: "text-text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_STYLES[status] ?? "text-text-secondary"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status}
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
