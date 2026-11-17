"use client";

import { useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { Card, btn } from "@/components/ui";
import {
  SEED_KIND_LABEL,
  seedLabel,
  type SeedInput,
} from "@/lib/discover-seeds";
import { formatInt } from "@/lib/format";

/**
 * A discovery's seeds and what each one returned, above its results table.
 * Clicking a seed shows only its rows (the same filter as the Seed select).
 */

export type RunSeedInfo = SeedInput & {
  position: number;
  status: "pending" | "done" | "failed";
  ideasTotal: number | null;
  ideasKept: number;
  truncated: boolean;
  error: string | null;
};

/** Seeds listed before "Show all". */
const SHOWN = 6;

export function SeedsSummary({
  seeds,
  active,
  onPick,
}: {
  seeds: RunSeedInfo[];
  /** Position of the seed the table is filtered to, or null. */
  active: number | null;
  onPick: (position: number | null) => void;
}) {
  const [all, setAll] = useState(false);
  const rejected = seeds.filter((s) => s.status === "failed").length;
  const cut = seeds.filter((s) => s.truncated).length;
  const list = all ? seeds : seeds.slice(0, SHOWN);

  return (
    <section data-testid="seeds-summary" aria-label="Seeds">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-text">
            Seeds{" "}
            <span className="num font-normal text-text-muted">
              ({formatInt(seeds.length)})
            </span>
          </h2>
          <p className="num text-xs text-text-muted">
            {rejected > 0 && `${formatInt(rejected)} rejected by Google`}
            {rejected > 0 && cut > 0 && " · "}
            {cut > 0 && `${formatInt(cut)} cut short by the limit`}
            {rejected === 0 &&
              cut === 0 &&
              "Click a seed to see only its keywords."}
          </p>
        </div>
        <ul className="divide-y divide-border">
          {list.map((s) => {
            const isActive = active === s.position;
            const usable = s.status === "done" && s.ideasKept > 0;
            return (
              <li
                key={s.position}
                className={
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 " +
                  (isActive ? "bg-accent-soft" : "")
                }
              >
                <span className="shrink-0" aria-hidden>
                  {s.status === "failed" ? (
                    <CircleAlert size={15} className="text-heat-red" />
                  ) : (
                    <Check size={15} className="text-heat-green" />
                  )}
                </span>
                {usable ? (
                  <button
                    type="button"
                    onClick={() => onPick(isActive ? null : s.position)}
                    aria-pressed={isActive}
                    title={
                      isActive
                        ? "Show every seed again"
                        : "Show only this seed's keywords"
                    }
                    className="min-w-0 flex-1 truncate rounded-[3px] text-left font-mono text-[13px] text-text underline-offset-2 hover:text-accent hover:underline"
                  >
                    {seedLabel(s)}
                  </button>
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[13px] text-text-muted"
                    title={seedLabel(s)}
                  >
                    {seedLabel(s)}
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  {SEED_KIND_LABEL[s.kind]}
                </span>
                <span
                  className={
                    "num min-w-[9rem] text-right text-xs " +
                    (s.status === "failed"
                      ? "text-heat-red"
                      : "text-text-secondary")
                  }
                >
                  {s.status === "failed"
                    ? `Rejected: ${s.error ?? "no reason given"}`
                    : s.truncated
                      ? `${formatInt(s.ideasKept)} of ${formatInt(s.ideasTotal ?? s.ideasKept)} (limit)`
                      : `${formatInt(s.ideasKept)} ${s.ideasKept === 1 ? "keyword" : "keywords"}`}
                </span>
              </li>
            );
          })}
        </ul>
        {seeds.length > SHOWN && (
          <div className="border-t border-border px-5 py-2">
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className={btn("ghost", "xs")}
            >
              {all ? "Show fewer" : `Show all ${formatInt(seeds.length)} seeds`}
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}
