"use client";

import { useMemo, useState } from "react";
import { BTN_SECONDARY, CONTROL, Card, EmptyState } from "@/components/ui";
import { formatCompact, formatInt, formatMicros } from "@/lib/format";
import { bandColorVar, bandFor, tertileBands, type HeatBands } from "@/lib/heat";
import type { DedupMode, ResultRow, RunSummary } from "@/lib/types";
import { Histogram, HeatLegend } from "./histogram";
import { Sparkline } from "./sparkline";
import { ExportModal } from "./export-modal";
import { useStoredColumns } from "@/lib/use-stored-columns";

/** Results table, filters and summary — PLAN.md §6 screen 2. */

type ColumnKey = "lowTop" | "highTop" | "delta" | "cpc" | "volume" | "competition" | "spark";

const TOGGLEABLE: { key: ColumnKey; label: string }[] = [
  { key: "lowTop", label: "Low top-of-page" },
  { key: "highTop", label: "High top-of-page" },
  { key: "delta", label: "Change" },
  { key: "cpc", label: "Avg CPC (info)" },
  { key: "volume", label: "Volume" },
  { key: "competition", label: "Competition" },
  { key: "spark", label: "Trend" },
];

type SortKey = "position" | "keyword" | "highTop" | "cpc" | "volume" | "competition";

const VALID_COLUMNS = new Set<ColumnKey>(TOGGLEABLE.map((c) => c.key));

export function ResultsView({
  runId,
  rows,
  summary,
  mode,
  hasUpload,
  hasDeltas,
}: {
  runId: string;
  rows: ResultRow[];
  summary: RunSummary;
  mode: DedupMode;
  hasUpload: boolean;
  /** True once this run has been refreshed at least once. */
  hasDeltas: boolean;
}) {
  const [text, setText] = useState("");
  const [minCpc, setMinCpc] = useState("");
  const [maxCpc, setMaxCpc] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [competition, setCompetition] = useState("");
  const [hideNoData, setHideNoData] = useState(false);
  const [bucket, setBucket] = useState<{ from: number; to: number } | null>(null);
  const [storedColumns, storeColumns] = useStoredColumns();

  /*
   * Visible columns come from the user's saved preference, or all of them when
   * nothing is saved yet. The preference is authoritative — forcing the delta
   * column on for runs that have deltas would make its checkbox impossible to
   * untick.
   */
  const visible = useMemo<ColumnKey[]>(
    () =>
      storedColumns
        ? storedColumns.filter((k): k is ColumnKey => VALID_COLUMNS.has(k as ColumnKey))
        : TOGGLEABLE.map((c) => c.key),
    [storedColumns],
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: mode === "intact" ? "position" : "highTop",
    dir: mode === "intact" ? "asc" : "desc",
  });
  const [exporting, setExporting] = useState(false);
  const [customBands, setCustomBands] = useState<{ lower: string; upper: string }>({ lower: "", upper: "" });

  /*
   * PRIMARY METRIC: the low–high top-of-page band. Heat colouring, the
   * histogram and the summary all key off the HIGH top-of-page bid, because
   * that is what an advertiser actually pays to appear at the top. Average CPC
   * is kept as a secondary, informational column. See VERIFIED.md §7.
   */
  const bands: HeatBands | null = useMemo(() => {
    const lower = Number(customBands.lower);
    const upper = Number(customBands.upper);
    if (customBands.lower !== "" && customBands.upper !== "" && lower > 0 && upper > lower) {
      return { lower: lower * 1_000_000, upper: upper * 1_000_000, custom: true };
    }
    return tertileBands(rows.map((r) => r.highTopMicros));
  }, [rows, customBands]);

  const noDataCount = rows.filter((r) => r.noData).length;

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const min = minCpc === "" ? null : Number(minCpc) * 1_000_000;
    const max = maxCpc === "" ? null : Number(maxCpc) * 1_000_000;
    const minVol = minVolume === "" ? null : Number(minVolume);

    const out = rows.filter((r) => {
      if (hideNoData && r.noData) return false;
      if (q && !r.submitted.toLowerCase().includes(q)) return false;
      if (competition && r.competition !== competition) return false;

      // Filters target the primary metric, so a histogram click and the
      // min/max boxes agree with what the colours show.
      const top = r.highTopMicros;
      if ((min !== null || max !== null || bucket !== null) && top === null) return false;
      if (min !== null && top !== null && top < min) return false;
      if (max !== null && top !== null && top > max) return false;
      if (bucket !== null && top !== null && (top < bucket.from || top >= bucket.to)) return false;

      if (minVol !== null && (r.avgMonthlySearches ?? 0) < minVol) return false;
      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    // Nulls always sort last, regardless of direction — an absent CPC is not
    // "cheap", and burying it under real data is the useful behaviour.
    const cmpNum = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * dir;
    };

    return [...out].sort((a, b) => {
      switch (sort.key) {
        case "position":
          return ((a.position ?? 0) - (b.position ?? 0)) * dir;
        case "keyword":
          return a.submitted.localeCompare(b.submitted) * dir;
        case "highTop":
          return cmpNum(a.highTopMicros, b.highTopMicros);
        case "cpc":
          return cmpNum(a.averageCpcMicros, b.averageCpcMicros);
        case "volume":
          return cmpNum(a.avgMonthlySearches, b.avgMonthlySearches);
        case "competition":
          return cmpNum(a.competitionIndex, b.competitionIndex);
        default:
          return 0;
      }
    });
  }, [rows, text, minCpc, maxCpc, minVolume, competition, hideNoData, bucket, sort]);

  const show = (k: ColumnKey) => visible.includes(k);
  const filtersActive =
    text !== "" || minCpc !== "" || maxCpc !== "" || minVolume !== "" || competition !== "" || bucket !== null;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="space-y-4">
      {/* Summary + histogram */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            {/*
              Summary stats are computed over canonical keywords, not submitted
              rows — weighting by volume across duplicates would double-count.
              In intact mode the table shows more rows than this number, so say
              "unique" rather than leaving the two looking contradictory.
            */}
            <Stat label={mode === "intact" ? "Unique keywords" : "Keywords"} value={formatInt(summary.total)} />
            <Stat label="No data" value={formatInt(summary.noData)} />
            <Stat
              label="Wtd top-of-page"
              value={formatMicros(summary.weightedAvgHighTopMicros)}
              sub={`floor ${formatMicros(summary.weightedAvgLowTopMicros)}`}
              accent
            />
            <Stat label="Median top-of-page" value={formatMicros(summary.medianHighTopMicros)} />
            <Stat label="Monthly volume" value={formatCompact(summary.totalMonthlyVolume)} />
            <Stat
              label="Avg CPC (info)"
              value={formatMicros(summary.weightedAvgCpcMicros)}
              sub={`median ${formatMicros(summary.medianCpcMicros)}`}
              muted
            />
          </dl>

          <div className="w-full max-w-sm">
            <Histogram
              values={rows.map((r) => r.highTopMicros)}
              bands={bands}
              selected={bucket}
              onSelect={setBucket}
            />
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <HeatLegend bands={bands} />
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Search
            </label>
            <input
              id="q"
              className={`${CONTROL} w-full`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter keywords…"
            />
          </div>

          <NumberFilter label="Min top-of-page ₹" value={minCpc} onChange={setMinCpc} />
          <NumberFilter label="Max top-of-page ₹" value={maxCpc} onChange={setMaxCpc} />
          <NumberFilter label="Min volume" value={minVolume} onChange={setMinVolume} width="w-28" />

          <div>
            <label htmlFor="comp" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Competition
            </label>
            <select id="comp" className={CONTROL} value={competition} onChange={(e) => setCompetition(e.target.value)}>
              <option value="">Any</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Heat bands ₹</label>
            <div className="flex items-center gap-1">
              <input
                aria-label="Cheap band upper bound in rupees"
                className={`${CONTROL} w-20`}
                value={customBands.lower}
                onChange={(e) => setCustomBands((b) => ({ ...b, lower: e.target.value }))}
                placeholder="auto"
                inputMode="decimal"
              />
              <span className="text-text-muted">–</span>
              <input
                aria-label="Mid band upper bound in rupees"
                className={`${CONTROL} w-20`}
                value={customBands.upper}
                onChange={(e) => setCustomBands((b) => ({ ...b, upper: e.target.value }))}
                placeholder="auto"
                inputMode="decimal"
              />
            </div>
          </div>

          {filtersActive && (
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                setText("");
                setMinCpc("");
                setMaxCpc("");
                setMinVolume("");
                setCompetition("");
                setBucket(null);
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Columns</span>
            {TOGGLEABLE.filter((c) => c.key !== "delta" || hasDeltas).map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={show(c.key)}
                  onChange={() =>
                    storeColumns(
                      visible.includes(c.key) ? visible.filter((k) => k !== c.key) : [...visible, c.key],
                    )
                  }
                  className="accent-[var(--accent)]"
                />
                {c.label}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {noDataCount > 0 && (
              <button type="button" className={BTN_SECONDARY} onClick={() => setHideNoData((v) => !v)}>
                {hideNoData
                  ? `Show ${formatInt(noDataCount)} no-data ${noDataCount === 1 ? "row" : "rows"}`
                  : `Remove ${formatInt(noDataCount)} no-data ${noDataCount === 1 ? "row" : "rows"}`}
              </button>
            )}
            <button type="button" className={BTN_SECONDARY} onClick={() => setExporting(true)}>
              Export
            </button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-xs text-text-secondary">
            {formatInt(filtered.length)}
            {filtered.length !== rows.length && <span className="text-text-muted"> of {formatInt(rows.length)}</span>}{" "}
            rows
          </p>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            body="Loosen a filter, clear the histogram selection, or search for something else."
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border">
                  <Th onClick={() => toggleSort(mode === "intact" ? "position" : "keyword")}>
                    Keyword{sortArrow(mode === "intact" ? "position" : "keyword")}
                  </Th>
                  {show("lowTop") && <Th numeric>Low top-of-page</Th>}
                  {show("highTop") && (
                    <Th numeric onClick={() => toggleSort("highTop")}>High top-of-page{sortArrow("highTop")}</Th>
                  )}
                  {hasDeltas && show("delta") && <Th numeric>Change</Th>}
                  {show("cpc") && (
                    <Th numeric muted onClick={() => toggleSort("cpc")}>Avg CPC{sortArrow("cpc")}</Th>
                  )}
                  {show("volume") && <Th numeric onClick={() => toggleSort("volume")}>Volume{sortArrow("volume")}</Th>}
                  {show("competition") && (
                    <Th numeric onClick={() => toggleSort("competition")}>Comp{sortArrow("competition")}</Th>
                  )}
                  {show("spark") && <Th>Trend</Th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const band = bandFor(r.highTopMicros, bands);
                  return (
                    <tr
                      key={`${r.submitted}-${r.position ?? i}`}
                      className={
                        "border-b border-border last:border-0 hover:bg-accent-soft/40 " +
                        (r.noData ? "opacity-45" : "")
                      }
                    >
                      <td className="px-4 py-2 text-sm text-text">
                        <span className="block max-w-[320px] truncate" title={r.submitted}>
                          {r.submitted}
                        </span>
                        {r.canonical && r.canonical.toLowerCase() !== r.submitted.toLowerCase() && (
                          <span className="block max-w-[320px] truncate text-xs text-text-muted" title={r.canonical}>
                            → {r.canonical}
                          </span>
                        )}
                      </td>
                      {show("lowTop") && (
                        <td className="num px-4 py-2 text-right text-text-secondary">{formatMicros(r.lowTopMicros)}</td>
                      )}
                      {show("highTop") && (
                        <td className="num px-4 py-2 text-right" style={{ color: bandColorVar(band) }}>
                          {formatMicros(r.highTopMicros)}
                        </td>
                      )}
                      {hasDeltas && show("delta") && (
                        <td className="num px-4 py-2 text-right">
                          <Delta current={r.highTopMicros} previous={r.prevHighTopMicros} />
                        </td>
                      )}
                      {show("cpc") && (
                        <td className="num px-4 py-2 text-right text-text-muted">
                          {formatMicros(r.averageCpcMicros)}
                        </td>
                      )}
                      {show("volume") && (
                        <td className="num px-4 py-2 text-right text-text">{formatInt(r.avgMonthlySearches)}</td>
                      )}
                      {show("competition") && (
                        <td className="num px-4 py-2 text-right text-text-secondary">
                          {r.competitionIndex ?? "—"}
                        </td>
                      )}
                      {show("spark") && (
                        <td className="px-4 py-2">
                          <Sparkline data={r.monthlyVolumes} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {exporting && (
        <ExportModal runId={runId} mode={mode} hasUpload={hasUpload} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}

/**
 * Movement in the primary metric since the previous pull. A rise in what you
 * must bid is shown red and a fall green — this is a cost, not a score.
 */
function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return <span className="text-text-muted">—</span>;
  const diff = current - previous;
  if (diff === 0) return <span className="text-text-muted">no change</span>;
  const up = diff > 0;
  return (
    <span style={{ color: up ? "var(--heat-red)" : "var(--heat-green)" }}>
      {up ? "↑" : "↓"} {formatMicros(Math.abs(diff))}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className={`text-xs ${muted ? "text-text-muted" : "text-text-secondary"}`}>{label}</dt>
      <dd
        className={
          "num mt-0.5 text-[15px] " +
          (accent ? "font-semibold text-accent" : muted ? "text-text-secondary" : "text-text")
        }
      >
        {value}
      </dd>
      {sub && <dd className="num mt-0.5 text-[11px] text-text-muted">{sub}</dd>}
    </div>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
  width = "w-24",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</label>
      <input
        aria-label={label}
        className={`${CONTROL} ${width}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="—"
      />
    </div>
  );
}

function Th({
  children,
  numeric,
  muted,
  onClick,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      className={
        "whitespace-nowrap px-4 py-2 text-xs font-medium " +
        (muted ? "text-text-muted " : "text-text-secondary ") +
        (numeric ? "text-right " : "") +
        (onClick ? "cursor-pointer select-none hover:text-accent" : "")
      }
      onClick={onClick}
      aria-sort={onClick ? "none" : undefined}
    >
      {children}
    </th>
  );
}
