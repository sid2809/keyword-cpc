"use client";

import { bandColorVar, bandFor, histogram, type HeatBands } from "@/lib/heat";
import { formatMicros } from "@/lib/format";

/**
 * Distribution of the primary metric (PLAN.md §6): "bucket keywords into ₹
 * bands; clicking a bar filters the table". Bars are coloured by the same heat
 * bands as the primary column, so the chart and the table agree.
 */
export function Histogram({
  values,
  bands,
  selected,
  onSelect,
}: {
  /** The primary metric's values, in micros — currently high top-of-page bid. */
  values: (number | null)[];
  bands: HeatBands | null;
  selected: { from: number; to: number } | null;
  onSelect: (range: { from: number; to: number } | null) => void;
}) {
  const buckets = histogram(values);
  if (buckets.length === 0) return null;

  const max = Math.max(...buckets.map((b) => b.count));

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {buckets.map((b) => {
          const isSelected = selected !== null && selected.from === b.from && selected.to === b.to;
          const midpoint = (b.from + b.to) / 2;
          const color = bandColorVar(bandFor(midpoint, bands));
          const heightPct = max > 0 ? (b.count / max) * 100 : 0;

          return (
            <button
              key={b.from}
              type="button"
              onClick={() => onSelect(isSelected ? null : { from: b.from, to: b.to })}
              title={`${formatMicros(b.from)} – ${formatMicros(b.to)} · ${b.count} keyword${b.count === 1 ? "" : "s"}`}
              aria-label={`${b.count} keyword${b.count === 1 ? "" : "s"} between ${formatMicros(b.from)} and ${formatMicros(b.to)} top-of-page`}
              aria-pressed={isSelected}
              className="group flex h-full flex-1 flex-col justify-end"
            >
              {/*
                A bucket holding one keyword still gets 3px so it is visible,
                but an EMPTY bucket must draw nothing — a stub bar reads as
                data that isn't there.
              */}
              <span
                className="w-full rounded-t-[3px] transition-[opacity,height] duration-150"
                style={{
                  height: b.count === 0 ? 0 : `max(3px, ${heightPct}%)`,
                  backgroundColor: color,
                  opacity: selected === null || isSelected ? 1 : 0.3,
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] text-text-muted">
        <span className="num">{formatMicros(buckets[0].from)}</span>
        {selected && (
          <button type="button" onClick={() => onSelect(null)} className="font-medium text-accent hover:underline">
            Clear filter
          </button>
        )}
        <span className="num">{formatMicros(buckets[buckets.length - 1].to)}</span>
      </div>
    </div>
  );
}

/** Small legend explaining what the colours mean (§5). */
export function HeatLegend({ bands }: { bands: HeatBands | null }) {
  if (!bands) return null;
  const items = [
    { band: "cheap" as const, label: `up to ${formatMicros(bands.lower)}` },
    { band: "mid" as const, label: `to ${formatMicros(bands.upper)}` },
    { band: "expensive" as const, label: `above ${formatMicros(bands.upper)}` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
      <span>{bands.custom ? "Your bands" : "Bands (this run's tertiles)"}:</span>
      {items.map((i) => (
        <span key={i.band} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: bandColorVar(i.band) }}
            aria-hidden
          />
          <span className="num">{i.label}</span>
        </span>
      ))}
    </div>
  );
}
