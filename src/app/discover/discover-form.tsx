"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Clock, Lightbulb } from "lucide-react";
import { BTN_PRIMARY, CARD, CONTROL, CONTROL_SM, Field, btn } from "@/components/ui";
import { SettingsPanel } from "@/app/new-search/settings-panel";
import { MAX_IDEA_LIMIT, MAX_SEEDS, SEED_KIND_LABEL, readSeedText, type SeedKind } from "@/lib/discover-seeds";
import { formatDuration, formatInt } from "@/lib/format";
import type { RunSettings } from "@/lib/types";
import { DiscoverProgress } from "./discover-progress";

/**
 * The Discover form: seeds (one per line), the usual settings, an optional
 * limit, and a bar that says what starting will cost. Each seed becomes one
 * request, so the list under the box shows exactly what each line is sent as.
 */

/** Seconds per seed for the estimate: one full-size real reply took 4.6 s (VERIFIED.md §9). */
const SECONDS_PER_SEED = 5;
/** Lines listed under the box before the rest are summarised. */
const LINES_SHOWN = 40;

export function DiscoverForm({ defaultSettings }: { defaultSettings: RunSettings }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<ReadonlyMap<string, SeedKind>>(new Map());
  const [settings, setSettings] = useState<RunSettings>(defaultSettings);
  const [limit, setLimit] = useState("");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<{ id: string; seeds: number } | null>(null);

  const lines = useMemo(() => readSeedText(text, overrides), [text, overrides]);
  const seeds = useMemo(() => lines.filter((l) => l.seed && !l.duplicate).map((l) => l.seed!), [lines]);
  const badLines = lines.filter((l) => l.error).length;
  const repeats = lines.filter((l) => l.duplicate).length;

  const limitTrimmed = limit.trim();
  const limitValue = limitTrimmed === "" ? null : Number(limitTrimmed);
  const limitError =
    limitValue !== null && (!/^\d+$/.test(limitTrimmed) || limitValue < 1 || limitValue > MAX_IDEA_LIMIT)
      ? `A whole number from 1 to ${formatInt(MAX_IDEA_LIMIT)}, or empty.`
      : null;

  const tooMany = seeds.length > MAX_SEEDS;
  const blocked = seeds.length === 0 || badLines > 0 || tooMany || limitError !== null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seeds, settings, limit: limitValue, name, tag }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not start the discovery.");
      setActiveRun({ id: json.id, seeds: json.seeds });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the discovery.");
    } finally {
      setSubmitting(false);
    }
  }

  if (activeRun) {
    return (
      <DiscoverProgress
        runId={activeRun.id}
        seedCount={activeRun.seeds}
        onOpen={() => router.push(`/runs/${activeRun.id}`)}
        onAnother={() => setActiveRun(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col">
        <label htmlFor="seeds" className="mb-2 text-sm font-semibold text-text">
          Seeds
        </label>
        <textarea
          id="seeds"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            // A type chosen for a line lasts as long as that line does.
            setOverrides((prev) => {
              if (prev.size === 0) return prev;
              const present = new Set(readSeedText(next).map((l) => l.text));
              const kept = new Map([...prev].filter(([line]) => present.has(line)));
              return kept.size === prev.size ? prev : kept;
            });
          }}
          spellCheck={false}
          placeholder={"running shoes\nhttps://example.com/blog/best-running-shoes\nexample.com\nrunning shoes | https://example.com/shoes"}
          className="min-h-[180px] resize-y rounded-[var(--radius-card)] border border-border-strong bg-surface p-4 font-mono text-[13px] leading-6 text-text shadow-card placeholder:text-text-muted hover:border-text-muted/50 focus:border-accent/60 focus:shadow-raised"
        />
        <p className="mt-2 text-xs text-text-muted">
          One seed per line: a keyword, a page address, a website, or{" "}
          <code className="rounded-[4px] bg-subtle px-1 py-0.5 font-mono text-[12px] text-text-secondary">keyword | page address</code>.
          Each seed is asked separately and keeps its own results. Up to {formatInt(MAX_SEEDS)} seeds.
        </p>
      </section>

      {lines.length > 0 && (
        <div className={`${CARD} fade-in overflow-hidden`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-text">What will be sent</h2>
            <p className="num text-xs text-text-muted" aria-live="polite">
              {formatInt(seeds.length)} {seeds.length === 1 ? "seed" : "seeds"}
              {repeats > 0 && ` · ${formatInt(repeats)} repeated, sent once`}
              {badLines > 0 && ` · ${formatInt(badLines)} cannot be used`}
            </p>
          </div>
          <ul className="divide-y divide-border" data-testid="seed-lines">
            {lines.slice(0, LINES_SHOWN).map((line, i) => (
              <li key={`${i}-${line.text}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className="num w-7 shrink-0 text-right text-xs text-text-muted">{i + 1}</span>
                <span
                  className={"min-w-0 flex-1 truncate font-mono text-[13px] " + (line.error || line.duplicate ? "text-text-muted" : "text-text")}
                  title={line.text}
                >
                  {line.text}
                </span>
                {line.error ? (
                  <span role="alert" className="flex items-center gap-1.5 text-xs text-heat-red">
                    <CircleAlert size={13} aria-hidden />
                    {SEED_KIND_LABEL[line.kind]}: {line.error}
                  </span>
                ) : line.duplicate ? (
                  <span className="text-xs text-text-muted">Repeat — sent once</span>
                ) : null}
                {line.choices.length > 1 ? (
                  <select
                    aria-label={`Type of seed ${i + 1}`}
                    className={`${CONTROL_SM} w-44`}
                    value={line.kind}
                    onChange={(e) =>
                      setOverrides((prev) => new Map(prev).set(line.text, e.target.value as SeedKind))
                    }
                  >
                    {line.choices.map((k) => (
                      <option key={k} value={k}>
                        {SEED_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="w-44 text-xs text-text-secondary">{SEED_KIND_LABEL[line.kind]}</span>
                )}
              </li>
            ))}
          </ul>
          {lines.length > LINES_SHOWN && (
            <p className="num border-t border-border px-5 py-2 text-xs text-text-muted">
              + {formatInt(lines.length - LINES_SHOWN)} more lines
            </p>
          )}
        </div>
      )}

      <SettingsPanel
        settings={settings}
        onChange={setSettings}
        name={name}
        onNameChange={setName}
        tag={tag}
        onTagChange={setTag}
        note="The same choices as a search. They apply to every seed."
        duplicatesSlot={
          <div className="sm:col-span-2">
            <Field
              label="Ideas per seed"
              htmlFor="idea-limit"
              hint={
                limitError ??
                "Empty keeps everything Google returns. A keyword usually returns a few thousand; a large website can return far more."
              }
            >
              <input
                id="idea-limit"
                inputMode="numeric"
                className={`${CONTROL} max-w-[220px] ${limitError ? "border-heat-red" : ""}`}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="No limit"
                aria-invalid={limitError !== null}
              />
            </Field>
          </div>
        }
      />

      <div className="sticky bottom-0 z-20 -mx-2 px-2 pt-2 pb-4">
        {error && (
          <div
            role="alert"
            className="fade-in mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-heat-red/30 bg-heat-red-soft px-3 py-2"
          >
            <span className="flex items-center gap-2 text-sm text-heat-red">
              <CircleAlert size={15} className="shrink-0" aria-hidden />
              {error}
            </span>
            <button type="button" onClick={submit} className={btn("secondary", "xs")}>
              Retry
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border-strong bg-raised px-5 py-3 shadow-overlay">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="discover-cost">
            <span className="num text-sm text-text">
              <span className="text-base font-semibold">{formatInt(seeds.length)}</span>{" "}
              <span className="text-text-secondary">{seeds.length === 1 ? "seed" : "seeds"}</span>
            </span>
            {seeds.length > 0 && !tooMany && (
              <>
                <span className="num text-xs text-text-muted">
                  {formatInt(seeds.length)} {seeds.length === 1 ? "request" : "requests"}
                </span>
                <span className="num inline-flex items-center gap-1 text-xs text-text-muted">
                  <Clock size={12} aria-hidden />~{formatDuration(seeds.length * SECONDS_PER_SEED)}
                </span>
                <span className="text-xs text-text-muted">
                  One request per seed; a seed with over 10,000 ideas needs one more per 10,000.
                </span>
              </>
            )}
            {tooMany && (
              <span className="text-xs text-heat-red">At most {formatInt(MAX_SEEDS)} seeds at a time.</span>
            )}
            {badLines > 0 && <span className="text-xs text-heat-red">Fix or remove the lines marked in red.</span>}
          </div>
          <button type="button" onClick={submit} disabled={blocked || submitting} className={`${BTN_PRIMARY} min-w-[200px]`}>
            <Lightbulb size={15} aria-hidden />
            {submitting ? "Starting…" : "Discover keywords"}
          </button>
        </div>
      </div>
    </div>
  );
}
