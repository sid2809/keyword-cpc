"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Globe, X } from "lucide-react";
import { COUNTRIES, countryById } from "@/lib/countries";
import { CONTROL_BASE } from "./ui";

/** List id for the Worldwide option; selecting it means no geo targets. */
const WORLDWIDE = "worldwide";

/**
 * Searchable multi-select for Google Ads countries (src/lib/countries.ts).
 *
 * - Selected countries show as chips; type to filter, click or Enter to tick.
 * - No countries = Worldwide (an empty list; Google's API reads that as all
 *   locations). The "Worldwide" option at the top and the clear button both
 *   empty the selection; the field then shows a Worldwide label.
 * - At most `max` countries (Google allows 10 geo targets per request); once
 *   full, unselected options are disabled until one is removed.
 * - Keyboard: ↑/↓ move, Enter toggles, Esc closes, Backspace on an empty
 *   search removes the last chip. ARIA combobox + multi-select listbox.
 *
 * Matching: names starting with the query come first, then names containing
 * it, then an exact two-letter country code (e.g. "gb").
 */
export function CountryPicker({
  id,
  value,
  onChange,
  max = 10,
}: {
  /** id of the search input, for the <label htmlFor>. */
  id: string;
  /** Selected geo target ids, e.g. ["geoTargetConstants/2840"]. */
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = useMemo(() => new Set(value), [value]);
  const full = value.length >= max;

  const countryResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const starts = COUNTRIES.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = COUNTRIES.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    const code =
      q.length === 2 ? COUNTRIES.filter((c) => c.code.toLowerCase() === q && !c.name.toLowerCase().includes(q)) : [];
    return [...starts, ...contains, ...code];
  }, [query]);

  // "Worldwide" leads the list when the search is empty or matches it.
  const q = query.trim().toLowerCase();
  const showWorldwide = q === "" || "worldwide".startsWith(q) || "all locations".startsWith(q);
  const results: { id: string; name: string; code: string }[] = showWorldwide
    ? [{ id: WORLDWIDE, name: "Worldwide (all locations)", code: "" }, ...countryResults]
    : [...countryResults];

  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  /** Empties the search after a pick, so typed text never looks like a selection. */
  function resetSearch() {
    setQuery("");
    setActive(0);
  }

  function toggle(countryId: string) {
    if (countryId === WORLDWIDE) {
      onChange([]);
      resetSearch();
    } else if (selected.has(countryId)) {
      onChange(value.filter((v) => v !== countryId));
    } else if (!full) {
      onChange([...value, countryId]);
      resetSearch();
    }
  }

  function scrollIntoView(index: number) {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const next =
        e.key === "ArrowDown" ? Math.min(activeIndex + 1, results.length - 1) : Math.max(activeIndex - 1, 0);
      setActive(next);
      scrollIntoView(next);
    } else if (e.key === "Enter") {
      if (open && results[activeIndex]) {
        e.preventDefault();
        toggle(results[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div
        className={`${CONTROL_BASE} chip-field flex min-h-9 cursor-text flex-wrap items-center gap-1 border-border-strong py-1 pr-12 pl-1.5 focus-within:border-accent/60`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
            setOpen(true);
          }
        }}
      >
        {value.length === 0 && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 text-xs font-medium text-accent">
            <Globe size={12} aria-hidden />
            Worldwide
          </span>
        )}
        {value.map((v) => {
          const name = countryById(v)?.name ?? `Unknown location (${v})`;
          return (
            <span
              key={v}
              className="chip-in inline-flex h-6 max-w-full items-center gap-0.5 rounded-full border border-border bg-subtle pr-0.5 pl-2 text-xs font-medium text-text"
            >
              <span className="truncate">{name}</span>
              <button
                type="button"
                onClick={() => toggle(v)}
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                className="grid h-5 w-5 place-items-center rounded-full text-text-muted hover:bg-border hover:text-text"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results.length > 0 ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={`${listId}-count`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={full ? `Max ${max} selected` : value.length === 0 ? "Add countries…" : "Add country…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-6 min-w-[7rem] flex-1 bg-transparent px-1 text-sm text-text outline-none placeholder:text-text-muted"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              resetSearch();
              inputRef.current?.focus();
            }}
            aria-label="Clear all countries (Worldwide)"
            title="Clear all (Worldwide)"
            className="absolute top-2 right-7 grid h-5 w-5 place-items-center rounded-full text-text-muted hover:bg-subtle hover:text-text"
          >
            <X size={13} aria-hidden />
          </button>
        )}
        <ChevronDown
          size={15}
          aria-hidden
          className={
            "pointer-events-none absolute top-2.5 right-2.5 text-text-muted motion-safe:transition-transform motion-safe:duration-[var(--dur-base)] " +
            (open ? "rotate-180" : "")
          }
        />
      </div>

      <p id={`${listId}-count`} className="sr-only">
        {value.length === 0 ? "Worldwide, no countries selected" : `${value.length} of ${max} countries selected`}
      </p>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Countries"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          className="fade-in absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-[var(--radius-card)] border border-border bg-raised p-1 shadow-overlay"
        >
          <li role="presentation" className="flex justify-between px-2 pt-1 pb-1.5 text-[11px] font-medium text-text-muted">
            <span>
              {countryResults.length === COUNTRIES.length ? `${COUNTRIES.length} countries` : `${countryResults.length} ${countryResults.length === 1 ? "match" : "matches"}`}
            </span>
            <span className={full ? "text-text-secondary" : ""}>
              {value.length}/{max} selected
            </span>
          </li>
          {results.length === 0 && (
            <li role="presentation" className="px-2 py-2 text-sm text-text-muted">
              No country matches “{query.trim()}”
            </li>
          )}
          {results.map((c, i) => {
            const worldwide = c.id === WORLDWIDE;
            const isSelected = worldwide ? value.length === 0 : selected.has(c.id);
            const disabled = !worldwide && !isSelected && full;
            return (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(c.id)}
                className={
                  "flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm " +
                  (i === activeIndex ? "bg-subtle " : "") +
                  (disabled ? "cursor-not-allowed text-text-muted " : "text-text ") +
                  (worldwide ? "mb-1 border-b border-border pb-2 font-medium " : "")
                }
              >
                <span
                  aria-hidden
                  className={
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border " +
                    (isSelected ? "border-accent bg-accent text-on-accent" : "border-border-strong bg-surface")
                  }
                >
                  {isSelected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                {worldwide ? (
                  <Globe size={13} className="text-text-muted" aria-hidden />
                ) : (
                  <span className="num text-[11px] text-text-muted">{c.code}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
