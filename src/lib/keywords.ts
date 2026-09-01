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
  /** Original row order among non-empty keywords. */
  position: number;
  /**
   * Index into the uploaded sheet's rows that this keyword came from, or null
   * for pasted input. Distinct from `position`, which skips blank cells —
   * conflating the two attaches the wrong sheet row to every keyword after a
   * gap.
   */
  sourceRow: number | null;
};

/**
 * Collapse internal runs of whitespace and trim. Casing preserved.
 *
 * Also strips characters Postgres cannot store in a `text` column. A NUL byte
 * reaches the driver and the INSERT dies with
 * `invalid byte sequence for encoding "UTF8": 0x00`, taking the whole run with
 * it — so control characters and unpaired surrogates are removed here, at the
 * one place every keyword passes through, rather than guarded at each INSERT.
 */
export function tidy(raw: string): string {
  return (
    String(raw ?? "")
      // C0/C1 controls except the whitespace ones, which the \s pass handles.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      // Lone surrogates are not valid UTF-8 and are rejected the same way.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Full normalisation for a submitted keyword: strip the characters Postgres
 * cannot store, collapse whitespace, then remove match-type wrappers.
 *
 * Wrapper stripping happens AFTER whitespace collapsing so `" keyword "`
 * reduces cleanly, and the result is tidied again because the interior may
 * have had its own padding.
 */
export function normalizeSubmitted(raw: string): string {
  return tidy(stripMatchTypeWrappers(tidy(raw)));
}

/**
 * Strips Google Ads match-type wrappers from a keyword.
 *
 *   "keyword"    phrase match
 *   [keyword]    exact match
 *   ""keyword""  a doubled-quote CSV escape that survived the export
 *
 * A wrapper is only removed when it encloses the WHOLE string and the interior
 * carries none of the same characters, so `"best of" 2025` and `[a] and [b]`
 * are left alone — they are keywords that happen to contain the character, not
 * wrapped ones. Apostrophes are never treated as wrappers, or "grey's anatomy"
 * would be mangled.
 *
 * Layers are peeled iteratively (bounded) so `"[keyword]"` reduces fully.
 */
const QUOTE_WRAPPED = /^(["\u201C\u201D]+)([^"\u201C\u201D]*)(["\u201C\u201D]+)$/;
const BRACKET_WRAPPED = /^\[+([^[\]]*)\]+$/;

export function stripMatchTypeWrappers(raw: string): string {
  let out = raw.trim();
  // Four passes covers every nesting seen in Ads exports; the loop exits early
  // as soon as a pass changes nothing.
  for (let i = 0; i < 4; i++) {
    const before = out;
    const q = QUOTE_WRAPPED.exec(out);
    if (q) out = q[2].trim();
    const b = BRACKET_WRAPPED.exec(out);
    if (b) out = b[1].trim();
    if (out === before) break;
  }
  // Never let stripping empty a keyword that had content.
  return out === "" ? raw.trim() : out;
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
    .map(normalizeSubmitted)
    .filter((s) => s.length > 0);

  return pieces.map((submitted, i) => ({
    submitted,
    normalized: submitted.toLowerCase(),
    position: i,
    sourceRow: null,
  }));
}

/**
 * Same normalisation for keywords arriving from a spreadsheet column.
 *
 * `values` MUST be the column exactly as it appears in the sheet, blanks
 * included — the array index is recorded as `sourceRow`, and pre-filtering it
 * would reintroduce the misalignment this exists to prevent.
 */
export function parseKeywordList(values: string[]): ParsedKeyword[] {
  const out: ParsedKeyword[] = [];
  values.forEach((value, index) => {
    const submitted = normalizeSubmitted(value ?? "");
    if (!submitted) return;
    out.push({
      submitted,
      normalized: submitted.toLowerCase(),
      position: out.length,
      sourceRow: index,
    });
  });
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
