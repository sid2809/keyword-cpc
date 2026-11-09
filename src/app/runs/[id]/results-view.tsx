"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Search,
  SearchX,
  X,
} from "lucide-react";
import {
  BTN_GHOST,
  BTN_SECONDARY,
  CARD,
  CONTROL,
  CONTROL_BASE,
  CONTROL_SM,
  Card,
  EmptyState,
  Skeleton,
  btn,
} from "@/components/ui";
import { formatCompact, formatInt, formatMicros } from "@/lib/format";
import { bandColorVar, bandFor, type HeatBands } from "@/lib/heat";
import type { DedupMode, ResultsOverview, ResultsPage, RunSummary } from "@/lib/types";
import {
  DEFAULT_PAGE_SIZE,
  EMPTY_FILTERS,
  PAGE_SIZES,
  countInputToNumber,
  defaultSort,
  filtersActive as anyFilterActive,
  filtersToParams,
  resultsQueryToParams,
  rupeesInputToMicros,
  sortToParams,
  type Competition,
  type PageSize,
  type ResultsFilters,
  type SortKey,
  type SortState,
} from "@/lib/results-params";
import { Histogram, HeatLegend } from "./histogram";
import { Sparkline } from "./sparkline";
import { ExportModal } from "./export-modal";
import { useStoredColumns } from "@/lib/use-stored-columns";
import { resultRowKey } from "@/lib/row-key";

/**
 * Results table, filters and summary — PLAN.md §6 screen 2.
 *
 * The table holds ONE PAGE of rows. Filtering, sorting and paging run in
 * Postgres via /api/runs/:id/results; the summary, histogram and heat bands
 * describe the whole run and arrive with the page. Holding every row in the
 * browser is what froze the tab on a 125,000-keyword run.
 */

type ColumnKey = "url" | "lowTop" | "highTop" | "delta" | "cpc" | "volume" | "competition" | "spark";

const TOGGLEABLE: { key: ColumnKey; label: string }[] = [
  { key: "url", label: "URL" },
  { key: "lowTop", label: "Low top-of-page" },
  { key: "highTop", label: "High top-of-page" },
  { key: "delta", label: "Change" },
  { key: "cpc", label: "Avg CPC (info)" },
  { key: "volume", label: "Volume" },
  { key: "competition", label: "Competition" },
  { key: "spark", label: "Trend" },
];

const VALID_COLUMNS = new Set<ColumnKey>(TOGGLEABLE.map((c) => c.key));

/** Typing in a text or number filter waits this long before querying. */
const TYPING_DEBOUNCE_MS = 300;

/** The part of a query that decides WHICH rows match and in what order. */
function matchKeyOf(filters: ResultsFilters, sort: SortState | null): string {
  return sortToParams(sort, filtersToParams(filters)).toString();
}

/** Equality on the four typed fields — the only ones that are debounced. */
function sameTyped(a: ResultsFilters, b: ResultsFilters): boolean {
  return (
    a.text === b.text &&
    a.minHighTopMicros === b.minHighTopMicros &&
    a.maxHighTopMicros === b.maxHighTopMicros &&
    a.minVolume === b.minVolume
  );
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    if (json.error) return json.error;
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `Request failed (${res.status}).`;
}

export function ResultsView({
  runId,
  initialPage,
  overview,
  summary,
  mode,
  hasUpload,
  hasDeltas,
  hasUrls,
}: {
  runId: string;
  /** Page 1 in the run's default order, rendered by the server. */
  initialPage: ResultsPage;
  overview: ResultsOverview;
  summary: RunSummary;
  mode: DedupMode;
  hasUpload: boolean;
  /** True once this run has been refreshed at least once. */
  hasDeltas: boolean;
  /**
   * True when the run came from a sheet with a designated URL column. Pasted
   * runs and sheets without one never show the column at all.
   */
  hasUrls: boolean;
}) {
  // --- filter inputs (what the user typed) ----------------------------------
  const [text, setText] = useState("");
  const [minCpc, setMinCpc] = useState("");
  const [maxCpc, setMaxCpc] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [hideNoData, setHideNoData] = useState(false);
  const [bucket, setBucket] = useState<{ from: number; to: number } | null>(null);
  const [storedColumns, storeColumns] = useStoredColumns();

  const minTop = rupeesInputToMicros(minCpc);
  const maxTop = rupeesInputToMicros(maxCpc);
  const minVol = countInputToNumber(minVolume);
  const invalid = {
    minCpc: Number.isNaN(minTop),
    maxCpc: Number.isNaN(maxTop),
    minVolume: Number.isNaN(minVol),
  };

  /*
   * The filters as typed. An entry that is not a number is shown as invalid
   * and left OUT of the query, rather than guessed at.
   */
  const liveFilters = useMemo<ResultsFilters>(
    () => ({
      text,
      minHighTopMicros: minTop === null || Number.isNaN(minTop) ? null : minTop,
      maxHighTopMicros: maxTop === null || Number.isNaN(maxTop) ? null : maxTop,
      bucket,
      minVolume: minVol === null || Number.isNaN(minVol) ? null : minVol,
      competition,
      hideNoData,
    }),
    [text, minTop, maxTop, bucket, minVol, competition, hideNoData],
  );

  // --- the query actually sent ------------------------------------------------
  /*
   * Typed fields are debounced so a keystroke does not fire a query; clicks
   * (selects, checkboxes, histogram bars) apply on the next tick.
   */
  const [filters, setFilters] = useState<ResultsFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  const liveKey = filtersToParams(liveFilters).toString();
  const committedKey = filtersToParams(filters).toString();
  useEffect(() => {
    if (liveKey === committedKey) return;
    const delay = sameTyped(liveFilters, filters) ? 0 : TYPING_DEBOUNCE_MS;
    const t = setTimeout(() => {
      setFilters(liveFilters);
      // A different set of rows: start again from the top.
      setPage(1);
    }, delay);
    return () => clearTimeout(t);
  }, [liveKey, committedKey, liveFilters, filters]);

  const activeSort = sort ?? defaultSort(mode);
  const queryKey = resultsQueryToParams({ filters, sort, page, pageSize }).toString();

  // --- fetching -----------------------------------------------------------------
  const [data, setData] = useState<{ key: string; page: ResultsPage }>(() => ({
    key: resultsQueryToParams({
      filters: EMPTY_FILTERS,
      sort: null,
      page: initialPage.page,
      pageSize: DEFAULT_PAGE_SIZE,
    }).toString(),
    page: initialPage,
  }));
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (data.key === queryKey) return;
    const controller = new AbortController();
    const requested = { filters, sort, page, pageSize };
    fetch(`/api/runs/${runId}/results?${queryKey}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const json = (await res.json()) as ResultsPage;
        // The server clamps a page past the end to the last page. File the
        // result under the page it actually is, then move there, so the
        // clamp does not trigger a second request.
        const servedKey = resultsQueryToParams({ ...requested, page: json.page }).toString();
        setData({ key: servedKey, page: json });
        setFetchError(null);
        if (json.page !== requested.page) setPage(json.page);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFetchError({ key: queryKey, message: err instanceof Error ? err.message : "Could not load results." });
      });
    return () => controller.abort();
    // `data.key` is deliberately not a dependency: a response arriving must
    // not restart the request that produced it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, retryNonce, runId]);

  const loading = data.key !== queryKey && fetchError?.key !== queryKey;
  const errorMessage = fetchError?.key === queryKey ? fetchError.message : null;
  const { rows, total } = data.page;

  // Back to the top of the table whenever a different page arrives.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [data.key]);

  // --- columns, bands -------------------------------------------------------------
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
  const show = (k: ColumnKey) => visible.includes(k);

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
    return overview.bands;
  }, [overview.bands, customBands]);

  const noDataCount = overview.noDataRows;
  const filtersOn = anyFilterActive(liveFilters);

  /** asc → desc → back to the run's default. */
  function cycleSort(key: SortKey) {
    setSort((s) => {
      const current = s ?? defaultSort(mode);
      if (s === null || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
    setPage(1);
  }

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    activeSort.key === key ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none";

  // --- selection -------------------------------------------------------------------
  const [exporting, setExporting] = useState(false);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);
  /*
   * Selection survives filter changes on purpose: a row hidden by a filter
   * stays selected, so you can narrow, pick, re-narrow and pick again before
   * exporting the union.
   */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Anchor for shift-click ranges, as a row key so it survives re-sorting.
  const lastClickedKey = useRef<string | null>(null);

  /*
   * Keys of EVERY row matching the current filters, in display order. The
   * table only holds a page, but "select all matching", shift-click ranges
   * across pages and the "n hidden by filters" count all need the full list.
   * Fetched only while something is selected (or on demand), and cached per
   * filter + sort.
   */
  const matchKey = matchKeyOf(filters, sort);
  const [matching, setMatching] = useState<{ key: string; keys: string[] } | null>(null);
  const inflight = useRef<{ key: string; promise: Promise<string[]> } | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);

  const fetchMatchingKeys = useCallback((): Promise<string[]> => {
    if (matching?.key === matchKey) return Promise.resolve(matching.keys);
    if (inflight.current?.key === matchKey) return inflight.current.promise;
    const key = matchKey;
    const promise = fetch(`/api/runs/${runId}/results/keys?${key}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const json = (await res.json()) as { keys: string[] };
        setMatching({ key, keys: json.keys });
        setKeysError(null);
        return json.keys;
      })
      .catch((err: unknown) => {
        setKeysError(err instanceof Error ? err.message : "Could not load the matching rows.");
        throw err;
      })
      .finally(() => {
        if (inflight.current?.key === key) inflight.current = null;
      });
    inflight.current = { key, promise };
    return promise;
  }, [matching, matchKey, runId]);

  const hasSelection = selectedKeys.size > 0;
  useEffect(() => {
    if (!hasSelection || matching?.key === matchKey) return;
    fetchMatchingKeys().catch(() => {
      // Surfaced through keysError.
    });
  }, [hasSelection, matching, matchKey, fetchMatchingKeys]);

  const matchingKeys = matching?.key === matchKey ? matching.keys : null;
  const matchingSet = useMemo(() => (matchingKeys ? new Set(matchingKeys) : null), [matchingKeys]);

  /** Selected rows that match the current filters; null until known. */
  const selectedInView = useMemo(() => {
    if (!matchingSet) return null;
    let n = 0;
    for (const k of selectedKeys) if (matchingSet.has(k)) n += 1;
    return n;
  }, [matchingSet, selectedKeys]);
  const allInViewSelected = matchingSet !== null && matchingSet.size > 0 && selectedInView === matchingSet.size;

  const [selectingAll, setSelectingAll] = useState(false);
  /** Select-all covers EVERY ROW MATCHING THE FILTERS, on every page. */
  const toggleAllMatching = useCallback(async () => {
    setSelectingAll(true);
    try {
      const keys = await fetchMatchingKeys();
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        const everySelected = keys.every((k) => next.has(k));
        for (const k of keys) {
          if (everySelected) next.delete(k);
          else next.add(k);
        }
        return next;
      });
    } catch {
      // Surfaced through keysError.
    } finally {
      setSelectingAll(false);
    }
  }, [fetchMatchingKeys]);

  /**
   * Shift-click selects the range between the previously clicked row and this
   * one, in the order currently displayed — across pages, using the full list
   * of matching keys. The range adopts the ANCHOR row's state, so
   * shift-clicking after a tick extends the selection and after an untick
   * clears it — the behaviour of every file list.
   *
   * The anchor is read and replaced BEFORE `setSelectedKeys`, not inside the
   * updater: React runs the updater during the following render, by which time
   * the ref would already hold the row just clicked, collapsing every range to
   * its two endpoints.
   *
   * It is stored as a row key rather than an index so re-sorting between two
   * clicks cannot select the wrong span.
   */
  const toggleRow = useCallback(
    async (key: string, shiftKey: boolean) => {
      const anchor = lastClickedKey.current;
      lastClickedKey.current = key;

      let ordered: string[] | null = null;
      if (shiftKey && anchor !== null) {
        try {
          ordered = await fetchMatchingKeys();
        } catch {
          // Without the order a range cannot be resolved; fall back to a
          // plain toggle of the clicked row rather than guessing a span.
          ordered = null;
        }
      }

      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (ordered !== null && anchor !== null) {
          const from = ordered.indexOf(anchor);
          const to = ordered.indexOf(key);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from <= to ? [from, to] : [to, from];
            const turningOn = prev.has(anchor);
            for (let i = lo; i <= hi; i++) {
              if (turningOn) next.add(ordered[i]);
              else next.delete(ordered[i]);
            }
            return next;
          }
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [fetchMatchingKeys],
  );

  // The Keyword header sorts by original position in intact mode (so it can
  // return the list to the user's order) and alphabetically when deduped.
  const keywordSortKey: SortKey = mode === "intact" ? "position" : "keyword";
  const selectedCount = selectedKeys.size;
  // Selections deliberately outlive filters, so some may not be on screen.
  const selectedHidden = selectedInView === null ? null : selectedCount - selectedInView;

  function clearFilters() {
    setText("");
    setMinCpc("");
    setMaxCpc("");
    setMinVolume("");
    setCompetition(null);
    setBucket(null);
  }

  // --- paging -----------------------------------------------------------------------
  const lastPage = Math.max(1, Math.ceil(total / data.page.pageSize));
  const firstRow = total === 0 ? 0 : (data.page.page - 1) * data.page.pageSize + 1;
  const lastRow = Math.min(total, data.page.page * data.page.pageSize);
  const [pageInput, setPageInput] = useState<string | null>(null);

  function goTo(p: number) {
    setPageInput(null);
    setPage(Math.min(Math.max(1, p), lastPage));
  }

  /*
   * Active filters as removable chips. Each ✕ empties exactly the input that
   * set the filter — the same as clearing that box by hand. Entries that are
   * not numbers are not applied (the box turns red), so they get no chip.
   */
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (text.trim() !== "") chips.push({ key: "q", label: `Search: “${text.trim()}”`, onRemove: () => setText("") });
  if (minTop !== null && !invalid.minCpc)
    chips.push({ key: "min", label: `Top-of-page ≥ ₹${minCpc.trim()}`, onRemove: () => setMinCpc("") });
  if (maxTop !== null && !invalid.maxCpc)
    chips.push({ key: "max", label: `Top-of-page ≤ ₹${maxCpc.trim()}`, onRemove: () => setMaxCpc("") });
  if (minVol !== null && !invalid.minVolume)
    chips.push({ key: "vol", label: `Volume ≥ ${minVolume.trim()}`, onRemove: () => setMinVolume("") });
  if (competition !== null)
    chips.push({
      key: "comp",
      label: `Competition: ${competition.charAt(0)}${competition.slice(1).toLowerCase()}`,
      onRemove: () => setCompetition(null),
    });
  if (bucket !== null)
    chips.push({
      key: "bucket",
      label: `Top-of-page ${formatMicros(bucket.from)} – ${formatMicros(bucket.to)}`,
      onRemove: () => setBucket(null),
    });
  if (hideNoData) chips.push({ key: "nodata", label: "No-data rows hidden", onRemove: () => setHideNoData(false) });

  /** Columns currently drawn — the skeleton rows span exactly these. */
  const columnCount =
    2 +
    (hasUrls && show("url") ? 1 : 0) +
    (show("lowTop") ? 1 : 0) +
    (show("highTop") ? 1 : 0) +
    (hasDeltas && show("delta") ? 1 : 0) +
    (show("cpc") ? 1 : 0) +
    (show("volume") ? 1 : 0) +
    (show("competition") ? 1 : 0) +
    (show("spark") ? 1 : 0);
  const skeletonRows = Math.min(Math.max(rows.length, 8), 12);

  return (
    <div className="space-y-4">
      {/*
        Summary — bento. Stats are computed over canonical keywords, not
        submitted rows — weighting by volume across duplicates would
        double-count. In intact mode the table shows more rows than the
        keyword count, so say "unique" rather than leaving the two looking
        contradictory.
      */}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Wtd top-of-page"
          value={formatMicros(summary.weightedAvgHighTopMicros)}
          sub={`floor ${formatMicros(summary.weightedAvgLowTopMicros)}`}
          accent
        />
        <StatCard label="Median top-of-page" value={formatMicros(summary.medianHighTopMicros)} />
        <StatCard label={mode === "intact" ? "Unique keywords" : "Keywords"} value={formatInt(summary.total)} />
        <StatCard label="No data" value={formatInt(summary.noData)} />
      </dl>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Top-of-page distribution</h2>
            <p className="text-xs text-text-muted">Click a bar to filter the table.</p>
          </div>
          <Histogram buckets={overview.histogram} bands={bands} selected={bucket} onSelect={setBucket} />
          <div className="mt-4 border-t border-border pt-3">
            <HeatLegend bands={bands} />
          </div>
        </Card>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <StatCard label="Monthly volume" value={formatCompact(summary.totalMonthlyVolume)} />
          <StatCard
            label="Avg CPC (info)"
            value={formatMicros(summary.weightedAvgCpcMicros)}
            sub={`median ${formatMicros(summary.medianCpcMicros)}`}
            muted
          />
        </dl>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Search
            </label>
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
                aria-hidden
              />
              <input
                id="q"
                className={`${CONTROL_BASE} border-border-strong h-9 w-full pr-3 pl-9`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Filter keywords…"
                maxLength={500}
              />
            </div>
          </div>

          <NumberFilter label="Min top-of-page ₹" value={minCpc} onChange={setMinCpc} invalid={invalid.minCpc} />
          <NumberFilter label="Max top-of-page ₹" value={maxCpc} onChange={setMaxCpc} invalid={invalid.maxCpc} />
          <NumberFilter
            label="Min volume"
            value={minVolume}
            onChange={setMinVolume}
            width="w-28"
            invalid={invalid.minVolume}
            inputMode="numeric"
          />

          <div>
            <label htmlFor="comp" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Competition
            </label>
            <select
              id="comp"
              className={CONTROL}
              value={competition ?? ""}
              onChange={(e) => setCompetition(e.target.value === "" ? null : (e.target.value as Competition))}
            >
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
                className={`${CONTROL} num w-20`}
                value={customBands.lower}
                onChange={(e) => setCustomBands((b) => ({ ...b, lower: e.target.value }))}
                placeholder="auto"
                inputMode="decimal"
              />
              <span className="text-text-muted">–</span>
              <input
                aria-label="Mid band upper bound in rupees"
                className={`${CONTROL} num w-20`}
                value={customBands.upper}
                onChange={(e) => setCustomBands((b) => ({ ...b, upper: e.target.value }))}
                placeholder="auto"
                inputMode="decimal"
              />
            </div>
          </div>

          {filtersOn && (
            <button type="button" className={BTN_GHOST} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {chips.length > 0 && (
          <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <li
                key={c.key}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-subtle pr-1 pl-3 text-xs font-medium text-text"
              >
                <span className="num">{c.label}</span>
                <button
                  type="button"
                  onClick={c.onRemove}
                  aria-label={`Remove filter: ${c.label}`}
                  title="Remove filter"
                  className="grid h-5 w-5 place-items-center rounded-full text-text-muted hover:bg-border hover:text-text"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-text-secondary">Columns</span>
          {TOGGLEABLE.filter((c) => (c.key !== "delta" || hasDeltas) && (c.key !== "url" || hasUrls)).map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary hover:text-text">
              <input
                type="checkbox"
                checked={show(c.key)}
                onChange={() =>
                  storeColumns(visible.includes(c.key) ? visible.filter((k) => k !== c.key) : [...visible, c.key])
                }
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {c.label}
            </label>
          ))}
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="num text-sm text-text-secondary" aria-live="polite">
              {formatInt(total)}
              {total !== overview.rowCount && (
                <span className="text-text-muted"> of {formatInt(overview.rowCount)}</span>
              )}{" "}
              rows
              {loading && <span className="sr-only"> — loading</span>}
            </p>

            {selectedCount > 0 && (
              <div className="flex items-center gap-3 border-l border-border pl-4">
                <span className="text-xs font-medium text-accent">
                  {formatInt(selectedCount)} selected
                  {selectedHidden !== null && selectedHidden > 0 && (
                    <span className="font-normal text-text-muted" title="Selections are kept when filters change">
                      {" "}
                      ({formatInt(selectedHidden)} hidden by filters)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKeys(new Set());
                    lastClickedKey.current = null;
                  }}
                  className="text-xs font-medium text-text-secondary hover:text-text"
                >
                  Clear selection
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {noDataCount > 0 && (
              <button type="button" className={btn("secondary", "sm")} onClick={() => setHideNoData((v) => !v)}>
                {hideNoData ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                {hideNoData
                  ? `Show ${formatInt(noDataCount)} no-data ${noDataCount === 1 ? "row" : "rows"}`
                  : `Remove ${formatInt(noDataCount)} no-data ${noDataCount === 1 ? "row" : "rows"}`}
              </button>
            )}
            <button
              type="button"
              className={btn("secondary", "sm")}
              onClick={() => {
                setExportSelectionOnly(false);
                setExporting(true);
              }}
            >
              <Download size={14} aria-hidden />
              Export
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                className={btn("primary", "sm")}
                onClick={() => {
                  setExportSelectionOnly(true);
                  setExporting(true);
                }}
              >
                Export selected ({formatInt(selectedCount)})
              </button>
            )}
          </div>
        </div>

        {errorMessage !== null && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-border bg-heat-red-soft px-4 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm text-heat-red">
              <CircleAlert size={15} aria-hidden />
              {errorMessage}
            </span>
            <button
              type="button"
              onClick={() => {
                setFetchError(null);
                setRetryNonce((n) => n + 1);
              }}
              className={btn("secondary", "sm")}
            >
              Retry
            </button>
          </div>
        )}
        {keysError !== null && (
          <p role="alert" className="flex items-center gap-2 border-b border-border bg-heat-red-soft px-4 py-2 text-xs text-heat-red">
            <CircleAlert size={13} aria-hidden />
            {keysError}
          </p>
        )}

        {total === 0 && !loading ? (
          <EmptyState
            icon={<SearchX size={18} />}
            title="Nothing matches those filters"
            body="Loosen a filter, clear the histogram selection, or search for something else."
            action={
              filtersOn ? (
                <button type="button" className={BTN_SECONDARY} onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div ref={scrollRef} aria-busy={loading} className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-subtle">
                <tr className="border-b border-border">
                  <th className="w-10 bg-subtle px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allInViewSelected}
                      disabled={selectingAll}
                      ref={(el) => {
                        // Partial selection of the matching rows reads as indeterminate.
                        if (el) el.indeterminate = (selectedInView ?? 0) > 0 && !allInViewSelected;
                      }}
                      onChange={() => void toggleAllMatching()}
                      aria-label={
                        allInViewSelected
                          ? `Deselect all ${formatInt(total)} matching rows`
                          : `Select all ${formatInt(total)} matching rows`
                      }
                      title="Applies to every row matching the filters, on every page"
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </th>
                  <Th sortState={ariaSort(keywordSortKey)} onClick={() => cycleSort(keywordSortKey)}>
                    Keyword
                  </Th>
                  {hasUrls && show("url") && <Th>URL</Th>}
                  {show("lowTop") && (
                    <Th numeric sortState={ariaSort("lowTop")} onClick={() => cycleSort("lowTop")}>
                      Low top-of-page
                    </Th>
                  )}
                  {show("highTop") && (
                    <Th numeric sortState={ariaSort("highTop")} onClick={() => cycleSort("highTop")}>
                      High top-of-page
                    </Th>
                  )}
                  {hasDeltas && show("delta") && <Th numeric>Change</Th>}
                  {show("cpc") && (
                    <Th numeric muted sortState={ariaSort("cpc")} onClick={() => cycleSort("cpc")}>
                      Avg CPC
                    </Th>
                  )}
                  {show("volume") && (
                    <Th numeric sortState={ariaSort("volume")} onClick={() => cycleSort("volume")}>
                      Volume
                    </Th>
                  )}
                  {show("competition") && (
                    <Th numeric sortState={ariaSort("competition")} onClick={() => cycleSort("competition")}>
                      Comp
                    </Th>
                  )}
                  {show("spark") && <Th>Trend</Th>}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? // Skeleton rows while the next page loads — never stale data.
                    Array.from({ length: skeletonRows }, (_, i) => (
                      <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <Skeleton className="h-4 w-4" />
                        </td>
                        <td colSpan={columnCount - 1} className="px-4 py-3">
                          <Skeleton className={`h-4 ${i % 3 === 0 ? "w-11/12" : i % 3 === 1 ? "w-4/5" : "w-full"}`} />
                        </td>
                      </tr>
                    ))
                  : rows.map((r) => {
                      const band = bandFor(r.highTopMicros, bands);
                      const key = resultRowKey(r);
                      const isSelected = selectedKeys.has(key);
                      return (
                        <tr
                          key={key}
                          className={
                            "border-b border-border last:border-0 " +
                            (isSelected ? "bg-accent-soft" : "hover:bg-subtle")
                          }
                        >
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              // onClick carries shiftKey; onChange does not.
                              onClick={(e) => void toggleRow(key, e.shiftKey)}
                              onChange={() => {}}
                              aria-label={`Select ${r.submitted}`}
                              className="h-4 w-4 accent-[var(--accent)]"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            <span
                              className={
                                "block max-w-[320px] truncate " + (r.noData ? "text-text-muted" : "text-text")
                              }
                              title={r.submitted}
                            >
                              {r.submitted}
                            </span>
                            {r.canonical && r.canonical.toLowerCase() !== r.submitted.toLowerCase() && (
                              <span className="block max-w-[320px] truncate text-xs text-text-muted" title={r.canonical}>
                                → {r.canonical}
                              </span>
                            )}
                            {r.noData && (
                              <span className="mt-0.5 inline-block rounded-full bg-subtle px-1.5 text-[11px] font-medium text-text-muted">
                                No data
                              </span>
                            )}
                          </td>
                          {hasUrls && show("url") && (
                            <td className="px-4 py-2.5">
                              <UrlCell urls={r.urls} />
                            </td>
                          )}
                          {show("lowTop") && (
                            <td className="num px-4 py-2.5 text-right text-text-secondary">
                              {formatMicros(r.lowTopMicros)}
                            </td>
                          )}
                          {show("highTop") && (
                            <td className="num px-4 py-2.5 text-right font-medium" style={{ color: bandColorVar(band) }}>
                              {formatMicros(r.highTopMicros)}
                            </td>
                          )}
                          {hasDeltas && show("delta") && (
                            <td className="num px-4 py-2.5 text-right">
                              <Delta current={r.highTopMicros} previous={r.prevHighTopMicros} />
                            </td>
                          )}
                          {show("cpc") && (
                            <td className="num px-4 py-2.5 text-right text-text-muted">
                              {formatMicros(r.averageCpcMicros)}
                            </td>
                          )}
                          {show("volume") && (
                            <td className={"num px-4 py-2.5 text-right " + (r.noData ? "text-text-muted" : "text-text")}>
                              {formatInt(r.avgMonthlySearches)}
                            </td>
                          )}
                          {show("competition") && (
                            <td className="num px-4 py-2.5 text-right text-text-secondary">
                              {r.competitionIndex ?? "—"}
                            </td>
                          )}
                          {show("spark") && (
                            <td className="px-4 py-2.5">
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

        {/* Pagination */}
        {total > 0 && (
          <nav
            aria-label="Results pages"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5"
          >
            <p className="num text-xs text-text-secondary">
              Rows {formatInt(firstRow)}–{formatInt(lastRow)} of {formatInt(total)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                Rows per page
                <select
                  className={CONTROL_SM}
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as PageSize);
                    setPage(1);
                  }}
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <PageButton label="First page" onClick={() => goTo(1)} disabled={data.page.page <= 1}>
                  <ChevronsLeft size={15} aria-hidden />
                </PageButton>
                <PageButton
                  label="Previous page"
                  onClick={() => goTo(data.page.page - 1)}
                  disabled={data.page.page <= 1}
                >
                  <ChevronLeft size={15} aria-hidden />
                </PageButton>
              </div>
              <form
                className="flex items-center gap-1.5 text-xs text-text-secondary"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(pageInput);
                  if (pageInput !== null && Number.isInteger(n)) goTo(n);
                  else setPageInput(null);
                }}
              >
                Page
                <input
                  aria-label="Page number"
                  className={`${CONTROL_SM} num w-16 text-center`}
                  inputMode="numeric"
                  value={pageInput ?? String(data.page.page)}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => setPageInput(null)}
                />
                <span className="num">of {formatInt(lastPage)}</span>
              </form>
              <div className="flex items-center gap-1">
                <PageButton
                  label="Next page"
                  onClick={() => goTo(data.page.page + 1)}
                  disabled={data.page.page >= lastPage}
                >
                  <ChevronRight size={15} aria-hidden />
                </PageButton>
                <PageButton label="Last page" onClick={() => goTo(lastPage)} disabled={data.page.page >= lastPage}>
                  <ChevronsRight size={15} aria-hidden />
                </PageButton>
              </div>
            </div>
          </nav>
        )}
      </Card>

      {exporting && (
        <ExportModal
          runId={runId}
          mode={mode}
          hasUpload={hasUpload}
          hasUrls={hasUrls}
          selection={exportSelectionOnly ? [...selectedKeys] : undefined}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function PageButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={btn("secondary", "icon")}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

/**
 * Destination URL(s) for a row.
 *
 * Intact mode has at most one. Deduped mode can carry several, because variants
 * that collapsed into one canonical keyword may point at different pages — the
 * first is shown and the rest flagged as "+n more", with the full list in the
 * tooltip and in the export. Several pages competing for one keyword is a
 * finding worth surfacing, not something to hide behind a single value.
 */
function UrlCell({ urls }: { urls: string[] }) {
  if (urls.length === 0) return <span className="text-text-muted">—</span>;

  const [first, ...rest] = urls;
  return (
    <span className="flex items-baseline gap-1.5">
      <a
        href={first}
        target="_blank"
        rel="noopener noreferrer"
        // noopener matters: these URLs come from an uploaded file.
        title={urls.join("\n")}
        onClick={(e) => e.stopPropagation()}
        className="block max-w-[260px] truncate text-sm text-accent hover:underline"
      >
        {first.replace(/^https?:\/\//, "")}
      </a>
      {rest.length > 0 && (
        <span
          className="shrink-0 whitespace-nowrap text-xs text-text-muted"
          title={`Also targets:\n${rest.join("\n")}`}
        >
          +{rest.length} more
        </span>
      )}
    </span>
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

/** One bento card in the summary. */
function StatCard({
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
    <div className={`${CARD} flex flex-col justify-between gap-1 p-4`}>
      <dt className={`text-xs font-medium ${muted ? "text-text-muted" : "text-text-secondary"}`}>{label}</dt>
      <dd>
        <span
          className={
            "num block text-2xl font-semibold tracking-tight " +
            (accent ? "text-accent" : muted ? "text-text-secondary" : "text-text")
          }
        >
          {value}
        </span>
        {sub && <span className="num mt-0.5 block text-xs text-text-muted">{sub}</span>}
      </dd>
    </div>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
  width = "w-24",
  invalid = false,
  inputMode = "decimal",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
  /** True when the entry is not a number; it is then left out of the query. */
  invalid?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</label>
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? "Not a number — this filter is not applied" : undefined}
        className={`${CONTROL_BASE} h-9 px-3 ${width} ${invalid ? "border-heat-red" : "border-border-strong"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
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
  sortState,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  muted?: boolean;
  onClick?: () => void;
  sortState?: "ascending" | "descending" | "none";
}) {
  const sortable = Boolean(onClick);
  const active = sortState === "ascending" || sortState === "descending";
  const SortIcon = sortState === "ascending" ? ArrowUp : sortState === "descending" ? ArrowDown : ArrowUpDown;
  return (
    <th
      className={
        "whitespace-nowrap bg-subtle px-4 py-2.5 text-xs font-medium " +
        (active ? "text-text " : muted ? "text-text-muted " : "text-text-secondary ") +
        (numeric ? "text-right " : "") +
        (sortable ? "cursor-pointer select-none" : "")
      }
      // The whole cell sorts, as before; the button inside keeps it reachable
      // by keyboard and stops the click reaching the cell twice.
      onClick={onClick}
      aria-sort={sortable ? (sortState ?? "none") : undefined}
    >
      {sortable ? (
        // A real button keeps the header reachable by keyboard.
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className={
            "group inline-flex cursor-pointer items-center gap-1 rounded-[4px] font-medium hover:text-text " +
            (numeric ? "flex-row-reverse" : "")
          }
        >
          {children}
          <SortIcon
            size={13}
            aria-hidden
            className={active ? "text-accent" : "opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}
