import type { ReactNode } from "react";

/**
 * Shared primitives so the design system is expressed once.
 * Minimal with quiet depth: 1px borders, 6px controls, 8px cards, three
 * shadow levels (card / raised / overlay), no gradients behind data, and
 * subtle motion on the shared --dur-* timings (globals.css). All movement is
 * `motion-safe:`, so the OS "reduce motion" setting turns it off.
 */

/*
 * Sizes and colours are separate pieces so a call site never stacks two
 * heights or two paddings on one element. In Tailwind, when two classes set
 * the same property, the winner is decided by stylesheet order — not by order
 * in the class string — so "h-9 … h-8" is not a reliable way to resize.
 */

/** Input/select chrome without size or border colour. */
export const CONTROL_BASE =
  "rounded-[var(--radius-control)] border bg-surface text-sm text-text " +
  "placeholder:text-text-muted hover:border-text-muted/50 disabled:opacity-60 disabled:cursor-not-allowed";

export const CONTROL = `${CONTROL_BASE} border-border-strong h-9 px-3`;
export const CONTROL_SM = `${CONTROL_BASE} border-border-strong h-8 px-2.5`;

/** Tactile press: buttons dip 2% while held (not when disabled). */
export const PRESS = "motion-safe:enabled:active:scale-[0.98]";

const BTN_CORE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] " +
  `font-medium disabled:opacity-50 disabled:cursor-not-allowed ${PRESS}`;

const BTN_VARIANT = {
  primary: "bg-accent text-on-accent shadow-card hover:bg-accent-hover hover:shadow-raised",
  secondary: "border border-border-strong bg-surface text-text shadow-card hover:bg-subtle hover:shadow-raised",
  ghost: "text-text-secondary hover:bg-subtle hover:text-text",
} as const;

const BTN_SIZE = {
  md: "h-9 px-3 text-sm",
  sm: "h-8 px-2.5 text-sm",
  xs: "h-7 px-2 text-xs",
  /** Square icon-only button. */
  icon: "h-8 w-8 text-sm",
} as const;

export function btn(variant: keyof typeof BTN_VARIANT, size: keyof typeof BTN_SIZE = "md"): string {
  return `${BTN_CORE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]}`;
}

export const BTN_BASE = `${BTN_CORE} ${BTN_SIZE.md}`;
export const BTN_PRIMARY = btn("primary");
export const BTN_SECONDARY = btn("secondary");
export const BTN_GHOST = btn("ghost");

export const CARD = "rounded-[var(--radius-card)] border border-border bg-surface shadow-card";

/**
 * For cards the user points at or clicks: lifts 1px and gains the raised
 * shadow on hover. Add alongside CARD.
 */
export const CARD_HOVER =
  "transition-[box-shadow,translate,border-color] duration-[var(--dur-base)] ease-[var(--ease-out-soft)] " +
  "hover:shadow-raised hover:border-border-strong motion-safe:hover:-translate-y-px";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${CARD} ${className}`}>{children}</div>;
}

/**
 * Page header: a full-width tinted band under the top bar holding the
 * breadcrumb, title, one-line description and actions on the right. `meta`
 * sits beside the title (e.g. a status pill). `width` matches the page's
 * content column so the header lines up with it.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  breadcrumb,
  width = "wide",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumb?: ReactNode;
  width?: "wide" | "narrow";
}) {
  return (
    <header className="band-surface border-b border-border">
      <div className={`mx-auto w-full ${width === "narrow" ? "max-w-3xl" : "max-w-7xl"} px-6 pt-7 pb-6`}>
        {breadcrumb && <div className="mb-2">{breadcrumb}</div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
              {meta}
            </div>
            {description && <p className="mt-1.5 text-sm text-text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
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
    <div
      role="radiogroup"
      aria-label={name}
      className="inline-flex rounded-[var(--radius-control)] border border-border bg-subtle p-0.5"
    >
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
              "rounded-[4px] px-3 py-1 text-xs font-medium " +
              (active
                ? "bg-surface text-text shadow-card ring-1 ring-border"
                : "text-text-secondary hover:text-text")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Empty state. A faint accent glow sits behind the icon — the one place
 * (besides login) where a glow is allowed, never behind data.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {icon && (
        <div
          className="mb-2 grid h-11 w-11 place-items-center rounded-full border border-border bg-surface text-text-secondary"
          style={{ boxShadow: "0 0 0 8px var(--accent-soft), 0 0 32px 8px var(--accent-soft)" }}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="max-w-sm text-sm text-text-secondary">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[4px] bg-subtle ${className}`} aria-hidden />;
}

const STATUS_STYLES: Record<string, string> = {
  done: "bg-heat-green-soft text-status-done",
  running: "bg-accent-soft text-accent",
  queued: "bg-subtle text-text-secondary",
  failed: "bg-heat-red-soft text-heat-red",
  canceled: "bg-subtle text-text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  done: "Done",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
  canceled: "Canceled",
};

/** Status pill. Colour is never the only signal: the label is always shown. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium " +
        (STATUS_STYLES[status] ?? "bg-subtle text-text-secondary")
      }
    >
      <span
        className={"h-1.5 w-1.5 rounded-full bg-current " + (status === "running" ? "animate-pulse" : "")}
        aria-hidden
      />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-subtle shadow-[inset_0_1px_1px_rgb(0_0_0/0.06)]"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={
          "relative h-full overflow-hidden rounded-full bg-gradient-to-r from-accent to-accent-hover " +
          "transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-soft)] " +
          (pct > 0 && pct < 100 ? "progress-sheen" : "")
        }
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
