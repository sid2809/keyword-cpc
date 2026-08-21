"use client";

import { monthLabel } from "@/lib/format";
import type { MonthlyVolume } from "@/lib/types";

/**
 * 12-month volume sparkline (PLAN.md §6), column toggleable.
 *
 * The series length is deliberately NOT assumed to be 12 — VERIFIED.md §3 found
 * the newest month is eventually-consistent, so runs can legitimately carry 11
 * or 12 points. The path is drawn from whatever arrives.
 */
export function Sparkline({ data }: { data: MonthlyVolume[] | null }) {
  if (!data || data.length < 2) return <span className="text-text-muted">—</span>;

  const width = 72;
  const height = 20;
  const values = data.map((d) => d.searches);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    // Inset by 1px top and bottom so the stroke isn't clipped at the extremes.
    const y = height - 1 - ((d.searches - min) / span) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = data[0];
  const last = data[data.length - 1];
  const title = `${monthLabel(first.year, first.month)} – ${monthLabel(last.year, last.month)}: ${min.toLocaleString("en-IN")} to ${max.toLocaleString("en-IN")} searches/mo`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      className="overflow-visible align-middle"
    >
      <title>{title}</title>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={width}
        cy={height - 1 - ((last.searches - min) / span) * (height - 2)}
        r="1.75"
        fill="var(--accent)"
      />
    </svg>
  );
}
