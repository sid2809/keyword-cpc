"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FolderKanban,
  Globe,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
} from "lucide-react";
import { CONTROL_SM, Card, EmptyState, Skeleton, btn } from "@/components/ui";
import { toast } from "@/components/toast";
import { Sparkline } from "@/app/runs/[id]/sparkline";
import { GeoPanel } from "@/app/runs/[id]/geo-panel";
import { GeoJobsStrip, useGeoJobs } from "@/app/runs/[id]/geo-bulk";
import { ProjectActionDialog, RefreshStrip, useProjectJob, type ActionTarget } from "./project-actions";
import { countryById } from "@/lib/countries";
import { languageName } from "@/lib/languages";
import { formatInt, formatMicros } from "@/lib/format";
import {
  DEFAULT_PROJECT_QUERY,
  EMPTY_PROJECT_FILTERS,
  PROJECT_PAGE_SIZES,
  projectFiltersActive,
  projectQueryToParams,
  type ProjectFilters,
  type ProjectPageSize,
  type ProjectQuery,
  type ProjectSortKey,
} from "@/lib/project-params";
import type { ProjectFacets, ProjectPage } from "@/lib/project-table";

/**
 * A project's keyword table. One page is held at a time; filtering, sorting
 * and paging run on the server (lib/project-table.ts), so a very large
 * project stays fast.
 *
 * "Show latest only" (on by default) shows each keyword's newest numbers;
 * switched off, every stored fetch is a row of its own, older ones muted.
 */

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const TYPING_MS = 250;

function locationLabel(geo: string[]): string {
  if (geo.length === 0) return "Worldwide";
  return geo.map((g) => countryById(g)?.name ?? g).join(", ");
}

function rupeesToMicros(input: string): number | null | "invalid" {
  const s = input.trim();
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return "invalid";
  return Math.round(Number(s) * 1_000_000);
}

function wholeNumber(input: string): number | null | "invalid" {
  const s = input.trim();
  if (s === "") return null;
  return /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : "invalid";
}

export function ProjectView({
  projectId,
  initialPage,
  facets,
}: {
  projectId: string;
  /** Page 1 in the default order, rendered by the server. */
  initialPage: ProjectPage;
  facets: ProjectFacets;
}) {
  const router = useRouter();
  const [query, setQuery] = useState<ProjectQuery>(DEFAULT_PROJECT_QUERY);
  const [data, setData] = useState<ProjectPage>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Typed filters, committed to the query after a short pause.
  const [text, setText] = useState("");
  const [minVol, setMinVol] = useState("");
  const [minBid, setMinBid] = useState("");
  const [maxBid, setMaxBid] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Refresh numbers / country breakdown
  const [action, setAction] = useState<"refresh" | "geo" | null>(null);
  const [jobNonce, setJobNonce] = useState(0);
  const [geoNonce, setGeoNonce] = useState(0);
  const [panel, setPanel] = useState<{ keyword: string; network: string } | null>(null);
  const refreshJob = useProjectJob(projectId, jobNonce, () => {
    setNonce((v) => v + 1); // new numbers in the table
    router.refresh();
  });
  const geoJobs = useGeoJobs(geoNonce);
  const refreshActive = refreshJob !== null && refreshJob.status !== "failed";

  const typed = useMemo(
    () => ({ minSearches: wholeNumber(minVol), minHighTopMicros: rupeesToMicros(minBid), maxHighTopMicros: rupeesToMicros(maxBid) }),
    [minVol, minBid, maxBid],
  );
  const typedInvalid = Object.values(typed).includes("invalid");

  useEffect(() => {
    if (typedInvalid) return;
    const t = setTimeout(() => {
      setQuery((q) => {
        const filters: ProjectFilters = {
          ...q.filters,
          text,
          minSearches: typed.minSearches as number | null,
          minHighTopMicros: typed.minHighTopMicros as number | null,
          maxHighTopMicros: typed.maxHighTopMicros as number | null,
        };
        const same = projectQueryToParams({ ...q, filters }).toString() === projectQueryToParams(q).toString();
        return same ? q : { ...q, filters, page: 1 };
      });
    }, TYPING_MS);
    return () => clearTimeout(t);
  }, [text, typed, typedInvalid]);

  // Fetch whenever the query changes (the first page came from the server).
  const queryKey = projectQueryToParams(query).toString();
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => !cancelled && setLoading(true), 150);
    fetch(`/api/projects/${projectId}/keywords?${queryKey}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (ProjectPage & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? `Could not load the keywords (${res.status}).`);
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, queryKey, nonce]);

  const { rows, total, page, pageSize } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const filtersOn = projectFiltersActive(query.filters);
  const pageEntryIds = useMemo(() => [...new Set(rows.map((r) => r.entryId))], [rows]);
  const allOnPageSelected = pageEntryIds.length > 0 && pageEntryIds.every((id) => selected.has(id));

  function setFilter(patch: Partial<ProjectFilters>) {
    setQuery((q) => ({ ...q, filters: { ...q.filters, ...patch }, page: 1 }));
  }

  function clearFilters() {
    setText("");
    setMinVol("");
    setMinBid("");
    setMaxBid("");
    setQuery((q) => ({ ...q, filters: EMPTY_PROJECT_FILTERS, page: 1 }));
  }

  function sortBy(key: ProjectSortKey) {
    setQuery((q) => ({
      ...q,
      page: 1,
      sort:
        q.sort.key === key
          ? { key, dir: q.sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "keyword" || key === "added" ? "asc" : "desc" },
    }));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageEntryIds) {
        if (allOnPageSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function removeSelected() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/keywords`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const body = (await res.json().catch(() => null)) as { removed?: number; error?: string } | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `Could not remove (${res.status}).`);
      const n = body.removed ?? 0;
      toast.success(`Removed ${formatInt(n)} ${n === 1 ? "keyword" : "keywords"} from the project.`);
      setSelected(new Set());
      setConfirmRemove(false);
      setNonce((v) => v + 1);
      router.refresh(); // header count and filter choices
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  }

  // Actions apply to the selection if there is one, else to the current filters.
  const filterParams = (() => {
    const p = projectQueryToParams({ ...DEFAULT_PROJECT_QUERY, filters: query.filters });
    return p.toString();
  })();
  const actionTarget: ActionTarget = selected.size > 0 ? { ids: [...selected] } : { filters: filterParams };
  const actionLabel =
    selected.size > 0
      ? `${formatInt(selected.size)} selected ${selected.size === 1 ? "keyword" : "keywords"}`
      : filtersOn
        ? "every keyword matching the filters"
        : "the whole project";
  const actionSuffix = selected.size > 0 ? ` (${formatInt(selected.size)})` : filtersOn ? " (filtered)" : "";

  const exportHref = (format: "csv" | "xlsx") => {
    const p = projectQueryToParams(query);
    p.set("format", format);
    return `/api/projects/${projectId}/export?${p}`;
  };

  if (initialPage.total === 0 && !filtersOn && total === 0 && query.latestOnly) {
    return (
      <Card>
        <EmptyState
          icon={<FolderKanban size={22} aria-hidden />}
          title="No keywords in this project yet"
          body="Open a run, select rows or click a keyword, and add them to this project."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))]">
          <FilterField label="Search" htmlFor="pf-q">
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute top-2 left-2.5 text-text-muted" aria-hidden />
              <input
                id="pf-q"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Filter keywords…"
                className={`${CONTROL_SM} w-full pl-8`}
              />
            </span>
          </FilterField>
          <FilterField label="Location" htmlFor="pf-geo">
            <select
              id="pf-geo"
              value={query.filters.geo ?? ""}
              onChange={(e) => setFilter({ geo: e.target.value || null })}
              className={`${CONTROL_SM} w-full`}
            >
              <option value="">Any</option>
              {facets.hasWorldwide && <option value="worldwide">Worldwide</option>}
              {facets.geos
                .map((g) => ({ id: g, name: countryById(g)?.name ?? g }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </FilterField>
          <FilterField label="Language" htmlFor="pf-lang">
            <select
              id="pf-lang"
              value={query.filters.language ?? ""}
              onChange={(e) => setFilter({ language: e.target.value || null })}
              className={`${CONTROL_SM} w-full`}
            >
              <option value="">Any</option>
              {facets.languages.map((l) => (
                <option key={l ?? "any"} value={l ?? "any"}>
                  {languageName(l)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Network" htmlFor="pf-net">
            <select
              id="pf-net"
              value={query.filters.network ?? ""}
              onChange={(e) => setFilter({ network: e.target.value || null })}
              className={`${CONTROL_SM} w-full`}
            >
              <option value="">Any</option>
              {facets.networks.map((n) => (
                <option key={n} value={n}>
                  {n === "GOOGLE_SEARCH" ? "Google Search" : "Search + partners"}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Min searches" htmlFor="pf-vol" invalid={typed.minSearches === "invalid"}>
            <input id="pf-vol" inputMode="numeric" value={minVol} onChange={(e) => setMinVol(e.target.value)} placeholder="—" className={`${CONTROL_SM} num w-full`} />
          </FilterField>
          <FilterField label="Min high bid ₹" htmlFor="pf-min" invalid={typed.minHighTopMicros === "invalid"}>
            <input id="pf-min" inputMode="decimal" value={minBid} onChange={(e) => setMinBid(e.target.value)} placeholder="—" className={`${CONTROL_SM} num w-full`} />
          </FilterField>
          <FilterField label="Max high bid ₹" htmlFor="pf-max" invalid={typed.maxHighTopMicros === "invalid"}>
            <input id="pf-max" inputMode="decimal" value={maxBid} onChange={(e) => setMaxBid(e.target.value)} placeholder="—" className={`${CONTROL_SM} num w-full`} />
          </FilterField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-text-secondary">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={query.latestOnly}
              onChange={(e) => setQuery((q) => ({ ...q, latestOnly: e.target.checked, page: 1 }))}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Show latest only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={query.filters.hideNoData}
              onChange={(e) => setFilter({ hideNoData: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Hide no-data rows
          </label>
          {filtersOn && (
            <button type="button" onClick={clearFilters} className="font-medium text-accent hover:underline">
              Clear filters
            </button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="text-sm text-text-secondary" aria-live="polite">
            <span className="num">{formatInt(total)}</span> {total === 1 ? "row" : "rows"}
            {!query.latestOnly && <span className="text-text-muted"> · every stored fetch</span>}
            {selected.size > 0 && (
              <>
                <span className="mx-2 text-border-strong">|</span>
                <span className="font-medium text-accent">{formatInt(selected.size)} selected</span>
                <button type="button" onClick={() => setSelected(new Set())} className="ml-2 text-xs font-medium hover:text-text">
                  Clear selection
                </button>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 &&
              (confirmRemove ? (
                <span className="fade-in inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-heat-red/30 bg-heat-red-soft py-1 pr-1 pl-3">
                  <span className="text-xs font-medium text-heat-red">
                    Remove {formatInt(selected.size)} and their history?
                  </span>
                  <button type="button" disabled={removing} onClick={() => void removeSelected()} className={`${btn("secondary", "xs")} text-heat-red`}>
                    {removing ? "Removing…" : "Remove"}
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className={btn("secondary", "xs")}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmRemove(true)} className={btn("secondary", "sm")}>
                  <Trash2 size={14} aria-hidden />
                  Remove from project ({formatInt(selected.size)})
                </button>
              ))}
            <button
              type="button"
              onClick={() => setAction("refresh")}
              disabled={refreshActive}
              title={refreshActive ? "A refresh is already running for this project" : undefined}
              className={btn("secondary", "sm")}
            >
              <RefreshCw size={14} aria-hidden />
              Refresh numbers{actionSuffix}
            </button>
            <button type="button" onClick={() => setAction("geo")} className={btn("secondary", "sm")}>
              <Globe size={14} aria-hidden />
              Country breakdown{actionSuffix}
            </button>
            <a href={exportHref("csv")} className={btn("secondary", "sm")}>
              <Download size={14} aria-hidden />
              CSV
            </a>
            <a href={exportHref("xlsx")} className={btn("secondary", "sm")}>
              <Download size={14} aria-hidden />
              XLSX
            </a>
          </div>
        </div>

        <RefreshStrip job={refreshJob} />
        <GeoJobsStrip jobs={geoJobs} />

        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-border bg-heat-red-soft px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm text-heat-red">
              <CircleAlert size={15} aria-hidden />
              {error}
            </span>
            <button type="button" onClick={() => setNonce((v) => v + 1)} className={btn("secondary", "sm")}>
              Retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" aria-busy={loading}>
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 bg-subtle px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    aria-label="Select every keyword on this page"
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </th>
                <Th sort={query.sort} k="keyword" onSort={sortBy}>Keyword</Th>
                <Th>Location</Th>
                <Th>Language</Th>
                <Th sort={query.sort} k="fetched" onSort={sortBy}>Fetched</Th>
                <Th sort={query.sort} k="searches" onSort={sortBy} numeric>Searches / mo</Th>
                <Th sort={query.sort} k="highTop" onSort={sortBy} numeric>High top bid</Th>
                <Th sort={query.sort} k="lowTop" onSort={sortBy} numeric>Low top bid</Th>
                <Th numeric>Avg CPC</Th>
                <Th>Competition</Th>
                <Th>Trend</Th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: Math.min(Math.max(rows.length, 6), 12) }, (_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td colSpan={11} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : rows.map((r, i) => {
                    const delta =
                      r.highTopMicros !== null && r.prevHighTopMicros !== null ? r.highTopMicros - r.prevHighTopMicros : null;
                    const isSelected = selected.has(r.entryId);
                    return (
                      <tr
                        key={r.fetchId}
                        style={{ "--i": i } as React.CSSProperties}
                        className={
                          "row-in border-b border-border transition-colors duration-[var(--dur-fast)] last:border-0 " +
                          (isSelected ? "bg-accent-soft " : "hover:bg-subtle ") +
                          (r.latest ? "" : "text-text-muted")
                        }
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(r.entryId)}
                            aria-label={`Select ${r.keyword}`}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          <button
                            type="button"
                            onClick={() => setPanel({ keyword: r.keyword.toLowerCase(), network: r.network })}
                            title={`${r.keyword} — country breakdown`}
                            className={
                              "block max-w-[280px] cursor-pointer truncate rounded-[4px] text-left hover:text-accent hover:underline " +
                              (r.latest && !r.noData ? "text-text" : "text-text-muted")
                            }
                          >
                            {r.keyword}
                          </button>
                          {r.noData && (
                            <span className="mt-0.5 mr-1.5 inline-block rounded-full bg-subtle px-1.5 text-[11px] font-medium text-text-muted">
                              No data
                            </span>
                          )}
                          {!r.latest && (
                            <span className="mt-0.5 inline-block rounded-full bg-subtle px-1.5 text-[11px] font-medium text-text-muted">
                              Older fetch
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-text-secondary">
                          <span className="block max-w-[160px] truncate" title={locationLabel(r.geo)}>
                            {locationLabel(r.geo)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-secondary">{languageName(r.language)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-secondary">
                          {DAY.format(new Date(r.fetchedAt))}
                          {r.latest && r.fetches > 1 && (
                            <span className="ml-1.5 text-text-muted" title={`${r.fetches} fetches stored`}>
                              ({r.fetches})
                            </span>
                          )}
                        </td>
                        <td className="num px-4 py-2.5 text-right">{r.noData ? "—" : formatInt(r.avgMonthlySearches)}</td>
                        <td className="num whitespace-nowrap px-4 py-2.5 text-right">
                          {formatMicros(r.highTopMicros)}
                          {delta !== null && delta !== 0 && (
                            <span
                              className="ml-1.5 inline-flex items-center text-[11px]"
                              style={{ color: delta > 0 ? "var(--heat-red)" : "var(--heat-green)" }}
                              title={`${delta > 0 ? "Up" : "Down"} ${formatMicros(Math.abs(delta))} since the previous fetch`}
                            >
                              {delta > 0 ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />}
                              {formatMicros(Math.abs(delta))}
                            </span>
                          )}
                        </td>
                        <td className="num px-4 py-2.5 text-right text-text-secondary">{formatMicros(r.lowTopMicros)}</td>
                        <td className="num px-4 py-2.5 text-right text-text-muted">{formatMicros(r.averageCpcMicros)}</td>
                        <td className="px-4 py-2.5 text-xs text-text-secondary">
                          {r.competition ? r.competition.charAt(0) + r.competition.slice(1).toLowerCase() : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Sparkline data={r.monthlyVolumes} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <EmptyState
              icon={<SearchX size={22} aria-hidden />}
              title="No keywords match these filters"
              body="Loosen or clear the filters to see more."
              action={
                <button type="button" onClick={clearFilters} className={btn("secondary", "sm")}>
                  Clear filters
                </button>
              }
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <p className="num text-xs text-text-secondary">
            {total === 0
              ? "No rows"
              : `Rows ${formatInt((page - 1) * pageSize + 1)}–${formatInt(Math.min(page * pageSize, total))} of ${formatInt(total)}`}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              Rows per page
              <select
                value={query.pageSize}
                onChange={(e) => setQuery((q) => ({ ...q, pageSize: Number(e.target.value) as ProjectPageSize, page: 1 }))}
                className={`${CONTROL_SM} h-7`}
              >
                {PROJECT_PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setQuery((q) => ({ ...q, page: page - 1 }))}
              className={btn("secondary", "icon")}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span className="num text-xs text-text-secondary">
              Page {formatInt(page)} of {formatInt(lastPage)}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= lastPage}
              onClick={() => setQuery((q) => ({ ...q, page: page + 1 }))}
              className={btn("secondary", "icon")}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
        </div>
      </Card>

      {action && (
        <ProjectActionDialog
          projectId={projectId}
          kind={action}
          target={actionTarget}
          targetLabel={actionLabel}
          onClose={() => setAction(null)}
          onStarted={(kind, count) => {
            setAction(null);
            const what = `${formatInt(count)} ${count === 1 ? "keyword" : "keywords"}`;
            if (kind === "refresh") {
              setJobNonce((v) => v + 1);
              toast.success(`Refreshing ${what}. New numbers appear here when it finishes.`);
            } else {
              setGeoNonce((v) => v + 1);
              toast.success(`Country breakdown started for ${what}. Click a keyword to see it.`);
            }
          }}
        />
      )}

      {panel && (
        <GeoPanel
          key={`${panel.keyword}|${panel.network}`}
          keyword={panel.keyword}
          network={panel.network === "GOOGLE_SEARCH_AND_PARTNERS" ? "GOOGLE_SEARCH_AND_PARTNERS" : "GOOGLE_SEARCH"}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function FilterField({
  label,
  htmlFor,
  invalid,
  children,
}: {
  label: string;
  htmlFor: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className={"text-xs font-medium " + (invalid ? "text-heat-red" : "text-text-secondary")}>
        {label}
        {invalid && <span className="font-normal"> · numbers only</span>}
      </label>
      {children}
    </div>
  );
}

function Th({
  children,
  numeric,
  k,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  k?: ProjectSortKey;
  sort?: ProjectQuery["sort"];
  onSort?: (key: ProjectSortKey) => void;
}) {
  const sortable = k !== undefined && onSort !== undefined;
  const active = sortable && sort?.key === k;
  const Icon = active ? ArrowUp : ArrowUpDown;
  return (
    <th
      className={
        "whitespace-nowrap bg-subtle px-4 py-2.5 text-xs font-medium " +
        (active ? "text-text " : "text-text-secondary ") +
        (numeric ? "text-right" : "")
      }
      aria-sort={sortable ? (active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(k)}
          className={"group inline-flex cursor-pointer items-center gap-1 rounded-[4px] font-medium hover:text-text " + (numeric ? "flex-row-reverse" : "")}
        >
          {children}
          <Icon
            size={12}
            aria-hidden
            className={
              active
                ? "text-accent transition-transform duration-[var(--dur-base)] ease-[var(--ease-out-soft)] " + (sort?.dir === "desc" ? "rotate-180" : "")
                : "opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
            }
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}
