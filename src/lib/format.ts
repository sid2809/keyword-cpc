/**
 * Display formatting. Client-safe — no Node imports, no server-only marker.
 *
 * PLAN.md §5: ₹1,234.56 with Indian digit grouping, micros ÷ 1,000,000.
 */

const INR = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const EM_DASH = "—";

/** ₹1,234.56, or an em dash when there is no value. */
export function formatMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return EM_DASH;
  return `₹${INR.format(micros / 1_000_000)}`;
}

/**
 * Bare rupee amount without the symbol, for CSV/XLSX cells.
 *
 * Rounded to paise so an exported cell reads the same as the on-screen value.
 * The raw micros are exact, but ₹58.5407 in a spreadsheet next to ₹58.54 in the
 * table is just confusing, and sub-paise precision is meaningless for CPC.
 */
export function microsToRupees(micros: number | null | undefined): number | null {
  if (micros === null || micros === undefined) return null;
  return Math.round(micros / 10_000) / 100;
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  return INT.format(n);
}

/** Compact form for dense table cells and axis labels: 1.8M, 60.5K. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return INT.format(n);
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? "?"} ${String(year).slice(2)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * ETA from the 1 rps rate limit: one request per chunk, one second apiece.
 * Deliberately conservative — cached chunks finish faster, never slower.
 */
export function estimateSeconds(keywordCount: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(keywordCount / chunkSize));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
