/**
 * CPC heat banding — PLAN.md §5.
 *
 * "Default bands = run tertiles (cheap/mid/expensive relative to this run) with
 * a small legend; user-defined absolute ₹ bands override via the filter panel."
 *
 * Client-safe: pure arithmetic, no imports.
 */

export type HeatBand = "cheap" | "mid" | "expensive";

export type HeatBands = {
  /** Upper bound of "cheap", in micros. */
  lower: number;
  /** Upper bound of "mid", in micros. */
  upper: number;
  /** True when the user pinned absolute bands instead of using run tertiles. */
  custom: boolean;
};

/**
 * Tertile cut points over the CPCs actually present in a run. Keywords with no
 * CPC are excluded — including them would drag the cut points toward zero.
 */
export function tertileBands(cpcMicros: (number | null)[]): HeatBands | null {
  const values = cpcMicros.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length === 0) return null;

  // With one or two distinct values, tertiles are meaningless; treat everything
  // as "mid" rather than inventing a spread.
  const distinct = new Set(values);
  if (distinct.size < 3) {
    return { lower: values[0] - 1, upper: values[values.length - 1] + 1, custom: false };
  }

  return {
    lower: quantile(values, 1 / 3),
    upper: quantile(values, 2 / 3),
    custom: false,
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : Math.round(sorted[base] + rest * (next - sorted[base]));
}

export function bandFor(cpcMicros: number | null, bands: HeatBands | null): HeatBand | null {
  if (cpcMicros === null || bands === null) return null;
  if (cpcMicros <= bands.lower) return "cheap";
  if (cpcMicros <= bands.upper) return "mid";
  return "expensive";
}

/** CSS custom property holding this band's colour, per the §5 palette. */
export function bandColorVar(band: HeatBand | null): string {
  switch (band) {
    case "cheap":
      return "var(--heat-green)";
    case "mid":
      return "var(--heat-amber)";
    case "expensive":
      return "var(--heat-red)";
    default:
      return "var(--text-muted)";
  }
}

export type Bucket = {
  /** Inclusive lower bound, micros. */
  from: number;
  /** Exclusive upper bound, micros. */
  to: number;
  count: number;
};

/**
 * Histogram of CPCs in equal-width ₹ buckets (PLAN.md §6: "bucket keywords into
 * ₹ bands; clicking a bar filters the table").
 *
 * Bucket width is rounded to a readable rupee step so axis labels are things
 * like ₹25 / ₹50 / ₹100 rather than ₹37.41.
 */
export function histogram(cpcMicros: (number | null)[], targetBuckets = 12): Bucket[] {
  const values = cpcMicros.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return [];

  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return [{ from: min, to: min + 1, count: values.length }];

  const rawWidth = (max - min) / targetBuckets;
  const width = niceStep(rawWidth);
  const start = Math.floor(min / width) * width;
  const bucketCount = Math.max(1, Math.ceil((max - start) / width) + (max % width === 0 ? 1 : 0));

  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: start + i * width,
    to: start + (i + 1) * width,
    count: 0,
  }));

  for (const v of values) {
    const i = Math.min(buckets.length - 1, Math.floor((v - start) / width));
    buckets[i].count += 1;
  }
  return buckets;
}

/** Rounds a bucket width up to 1, 2, 2.5 or 5 × a power of ten (in micros). */
function niceStep(raw: number): number {
  if (raw <= 0) return 1_000_000;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= magnitude * m) return magnitude * m;
  }
  return magnitude * 10;
}
