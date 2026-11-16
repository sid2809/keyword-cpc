"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Globe, RefreshCw, X } from "lucide-react";
import { ProgressBar, btn } from "@/components/ui";
import { countryById } from "@/lib/countries";
import { GEO_ALL } from "@/lib/geo-shortlist";
import { formatDuration, formatInt, formatMicros } from "@/lib/format";
import type { RunSettings } from "@/lib/types";

/**
 * Side panel: one keyword's metrics per country (lib/geo-breakdown.ts).
 *
 * Opening it shows whatever is already stored for the keyword this month and,
 * if the shortlist isn't complete, starts a background job for it. The panel
 * polls once a second while a job runs, so countries appear as Google answers.
 * Closing the panel does not stop the job. "Scan all countries" fetches the
 * rest. The table underneath stays usable; nothing reloads.
 */

type Row = {
  geo: string;
  noData: boolean;
  avgMonthlySearches: number | null;
  highTopMicros: number | null;
  lowTopMicros: number | null;
  averageCpcMicros: number | null;
  competition: string | null;
  competitionIndex: number | null;
};

type Breakdown = {
  keyword: string;
  rows: Row[];
  shortlistScanned: number;
  shortlistTotal: number;
  allScanned: number;
  allTotal: number;
  job: {
    id: string;
    status: "queued" | "running" | "done" | "failed";
    scope: "shortlist" | "all";
    done: number;
    total: number;
    error: string | null;
  } | null;
};

const POLL_MS = 1000;

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function GeoPanel({
  keyword,
  network,
  onClose,
}: {
  keyword: string;
  network: RunSettings["network"];
  onClose: () => void;
}) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const autoStarted = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (): Promise<Breakdown | null> => {
    const res = await fetch(`/api/geo?${new URLSearchParams({ keyword, network })}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load the breakdown (${res.status}).`);
    return (await res.json()) as Breakdown;
  }, [keyword, network]);

  const start = useCallback(
    async (scope: "shortlist" | "all") => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: [keyword], network, scope }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Could not start the breakdown (${res.status}).`);
        }
        setData(await load());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    },
    [keyword, network, load],
  );

  // Load on open; start the shortlist once if it isn't complete and nothing is running.
  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => {
        if (cancelled || !d) return;
        setData(d);
        if (!autoStarted.current && d.job === null && d.shortlistScanned < d.shortlistTotal) {
          autoStarted.current = true;
          void start("shortlist");
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [load, start]);

  // Poll while a job is active.
  const active = data?.job?.status === "queued" || data?.job?.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      load()
        .then((d) => d && setData(d))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  // Focus once on open (not on every parent render, which would steal focus
  // from the filters while the panel is open).
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { withData, withoutData, totalSearches } = useMemo(() => {
    const rows = data?.rows ?? [];
    const has = rows
      .filter((r) => !r.noData && r.avgMonthlySearches !== null)
      .sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
    const hasSet = new Set(has);
    return {
      withData: has,
      withoutData: rows.filter((r) => !hasSet.has(r)),
      totalSearches: has.reduce((sum, r) => sum + (r.avgMonthlySearches ?? 0), 0),
    };
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const order = new Map(GEO_ALL.map((c, i) => [c.id, i]));
    const lines = [
      ["Keyword", "Country", "Country code", "Avg monthly searches", "Share of scanned countries (%)", "High top-of-page bid", "Low top-of-page bid", "Average CPC", "Competition", "Competition index"].join(","),
      ...[...withData, ...[...withoutData].sort((a, b) => (order.get(a.geo) ?? 0) - (order.get(b.geo) ?? 0))].map((r) => {
        const c = countryById(r.geo);
        const micros = (v: number | null) => (v === null ? null : v / 1_000_000);
        const share =
          !r.noData && r.avgMonthlySearches !== null && totalSearches > 0
            ? Math.round((r.avgMonthlySearches / totalSearches) * 1000) / 10
            : null;
        return [
          data.keyword,
          c?.name ?? r.geo,
          c?.code ?? "",
          r.noData ? null : r.avgMonthlySearches,
          share,
          micros(r.highTopMicros),
          micros(r.lowTopMicros),
          micros(r.averageCpcMicros),
          r.competition,
          r.competitionIndex,
        ]
          .map(csvCell)
          .join(",");
      }),
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.keyword.replace(/[^\w-]+/g, "_").slice(0, 60)}-by-country.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const job = data?.job ?? null;
  const remaining = data ? data.allTotal - data.allScanned : 0;
  const canScanAll = data !== null && !active && !starting && remaining > 0 && data.shortlistScanned >= data.shortlistTotal;

  return (
    <aside
      role="dialog"
      aria-label={`Country breakdown for ${keyword}`}
      className="geo-panel fixed inset-y-0 right-0 z-40 flex w-full max-w-[560px] flex-col border-l border-border bg-raised shadow-overlay"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            <Globe size={13} aria-hidden />
            Country breakdown
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-text" title={keyword}>
            {keyword}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Any language · {network === "GOOGLE_SEARCH" ? "Google Search" : "Google Search + partners"}
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close country breakdown" className={btn("ghost", "icon")}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="border-b border-border px-5 py-3">
        {active && job ? (
          <div aria-live="polite">
            <div className="mb-1.5 flex justify-between text-xs text-text-secondary">
              <span>
                Asking Google: {job.done} of {job.total} countries
              </span>
              <span>about {formatDuration(Math.max(1, job.total - job.done))} left</span>
            </div>
            <ProgressBar value={job.done} max={job.total} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-secondary" aria-live="polite">
              {data === null
                ? "Loading…"
                : `${data.allScanned} of ${data.allTotal} countries scanned this month`}
            </p>
            <div className="flex items-center gap-2">
              {canScanAll && (
                <button type="button" onClick={() => void start("all")} className={btn("secondary", "sm")}>
                  Scan all countries
                  <span className="text-text-muted">
                    ({remaining} more, about {formatDuration(remaining)})
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={exportCsv}
                disabled={!data || data.rows.length === 0}
                className={btn("secondary", "sm")}
              >
                <Download size={14} aria-hidden />
                CSV
              </button>
            </div>
          </div>
        )}
        {(error || job?.status === "failed") && (
          <div role="alert" className="fade-in mt-2 flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-2.5 text-xs text-heat-red">
            <span>{error ?? `The scan stopped: ${job?.error ?? "unknown error"}`}</span>
            <button
              type="button"
              onClick={() => void start(job?.scope ?? "shortlist")}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-text hover:text-accent"
            >
              <RefreshCw size={12} aria-hidden />
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-raised">
            <tr className="border-b border-border text-xs font-medium text-text-secondary">
              <th className="px-5 py-2 font-medium">Country</th>
              <th className="px-3 py-2 text-right font-medium">Searches / mo</th>
              <th className="px-3 py-2 text-right font-medium" title="Share of the searches in the countries scanned so far">
                Share
              </th>
              <th className="px-3 py-2 text-right font-medium">High top bid</th>
              <th className="py-2 pr-5 pl-3 text-right font-medium">Low top bid</th>
            </tr>
          </thead>
          <tbody>
            {withData.map((r) => {
              const share = totalSearches > 0 ? ((r.avgMonthlySearches ?? 0) / totalSearches) * 100 : 0;
              return (
                <tr key={r.geo} className="row-in border-b border-border last:border-0">
                  <td className="px-5 py-2 text-sm text-text">
                    {countryById(r.geo)?.name ?? r.geo}
                    {r.competition && (
                      <span className="ml-2 text-[11px] text-text-muted">
                        {r.competition.charAt(0) + r.competition.slice(1).toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right text-text">{formatInt(r.avgMonthlySearches)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, share)}%` }} />
                      </span>
                      <span className="num w-11 text-right text-xs text-text-secondary">
                        {share >= 10 ? share.toFixed(0) : share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-right text-text-secondary">{formatMicros(r.highTopMicros)}</td>
                  <td className="num py-2 pr-5 pl-3 text-right text-text-secondary">{formatMicros(r.lowTopMicros)}</td>
                </tr>
              );
            })}
            {data !== null && withData.length === 0 && !active && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-muted">
                  Google returned no data for this keyword in the countries scanned.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {withoutData.length > 0 && (
          <details className="border-t border-border px-5 py-3 text-xs text-text-secondary">
            <summary className="cursor-pointer font-medium">
              No data in {withoutData.length} {withoutData.length === 1 ? "country" : "countries"}
            </summary>
            <p className="mt-2 leading-5 text-text-muted">
              {withoutData
                .map((r) => countryById(r.geo)?.name ?? r.geo)
                .sort((a, b) => a.localeCompare(b))
                .join(", ")}
            </p>
          </details>
        )}
      </div>

      <footer className="border-t border-border px-5 py-2.5 text-[11px] leading-4 text-text-muted">
        Each country is asked separately, so the figures may not add up to a Worldwide or multi-country total.
        Share is of the countries scanned so far.
      </footer>
    </aside>
  );
}
