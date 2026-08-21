/**
 * Keyword normalisation, per PLAN.md §6: trim, collapse whitespace, drop
 * empties, lowercase for canonical comparison but preserve the user's original
 * casing in `submitted_text`.
 */

export type ParsedKeyword = {
  /** Exactly what the user gave, minus surrounding whitespace. */
  submitted: string;
  /** Lowercased, whitespace-collapsed form used for comparison and sending. */
  normalized: string;
  /** Original row order. */
  position: number;
};

/** Collapse internal runs of whitespace and trim. Casing preserved. */
export function tidy(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function normalize(raw: string): string {
  return tidy(raw).toLowerCase();
}

/**
 * Splits pasted text into keywords. Accepts one-per-line and comma-separated,
 * including a mix of both. Empty entries are dropped.
 *
 * Duplicates are KEPT — `run_keywords` records every submitted row so "keep my
 * list intact" mode can reproduce the user's list exactly. De-duplication
 * happens only when building the API request.
 */
export function parseKeywordText(text: string): ParsedKeyword[] {
  const pieces = text
    .split(/[\n\r,]+/)
    .map(tidy)
    .filter((s) => s.length > 0);

  return pieces.map((submitted, i) => ({
    submitted,
    normalized: submitted.toLowerCase(),
    position: i,
  }));
}

/** Same normalisation for keywords arriving from a spreadsheet column. */
export function parseKeywordList(values: string[]): ParsedKeyword[] {
  const out: ParsedKeyword[] = [];
  for (const value of values) {
    const submitted = tidy(value ?? "");
    if (!submitted) continue;
    out.push({ submitted, normalized: submitted.toLowerCase(), position: out.length });
  }
  return out;
}

/**
 * Distinct normalized keywords in first-appearance order.
 *
 * Order matters: chunk boundaries are derived from this list, and a resumed run
 * must rebuild exactly the same chunks it started with.
 */
export function distinctNormalized(keywords: ParsedKeyword[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    if (seen.has(k.normalized)) continue;
    seen.add(k.normalized);
    out.push(k.normalized);
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
