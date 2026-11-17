import { normalizeSubmitted, tidy } from "./keywords";

/**
 * Discover seeds: reading what the user typed and checking it. Shared by the
 * Discover page (to show, as you type, what each line will be sent as) and the
 * server (which checks again and is the authority). No server imports.
 */

export type SeedKind = "keyword" | "url" | "keyword_url" | "site";

export type SeedInput = { kind: SeedKind; keyword: string | null; target: string | null };

export const SEED_KIND_LABEL: Record<SeedKind, string> = {
  keyword: "Keyword",
  url: "Page URL",
  keyword_url: "Keyword + page URL",
  site: "Whole website",
};

/** Each seed costs at least one request at 1 per second; this keeps a discovery to minutes. */
export const MAX_SEEDS = 500;
export const MAX_IDEA_LIMIT = 1_000_000;
const MAX_KEYWORD_CHARS = 500;
const MAX_URL_CHARS = 2_000;

export function cleanUrl(raw: unknown): string | null {
  const text = tidy(typeof raw === "string" ? raw : "");
  if (text === "" || text.length > MAX_URL_CHARS || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A site seed is a bare host ("www.example.com"); scheme, path and port are dropped. */
export function cleanSite(raw: unknown): string | null {
  const url = cleanUrl(raw);
  return url ? new URL(url).hostname.toLowerCase() : null;
}

export function cleanKeyword(raw: unknown): string | null {
  const text = normalizeSubmitted(typeof raw === "string" ? raw : "").slice(0, MAX_KEYWORD_CHARS);
  return text === "" ? null : text;
}

/** Builds a seed of the given kind, or says what is wrong with it. */
export function buildSeed(kind: unknown, keywordRaw: unknown, targetRaw: unknown): SeedInput | { error: string } {
  switch (kind) {
    case "keyword": {
      const keyword = cleanKeyword(keywordRaw);
      return keyword ? { kind, keyword, target: null } : { error: "the keyword is empty." };
    }
    case "url": {
      const target = cleanUrl(targetRaw);
      return target ? { kind, keyword: null, target } : { error: "that is not a usable page URL." };
    }
    case "keyword_url": {
      const keyword = cleanKeyword(keywordRaw);
      const target = cleanUrl(targetRaw);
      if (!keyword) return { error: "the keyword is empty." };
      return target ? { kind, keyword, target } : { error: "that is not a usable page URL." };
    }
    case "site": {
      const target = cleanSite(targetRaw);
      return target ? { kind, keyword: null, target } : { error: "that is not a usable website." };
    }
    default:
      return { error: "unknown seed type." };
  }
}

export function seedKey(seed: SeedInput): string {
  return `${seed.kind}|${seed.keyword?.toLowerCase() ?? ""}|${seed.target ?? ""}`;
}

/** What a seed is shown as: the keyword, the address, or "keyword + address". */
export function seedLabel(seed: SeedInput): string {
  if (seed.kind === "keyword") return seed.keyword ?? "";
  if (seed.kind === "keyword_url") return `${seed.keyword} + ${seed.target}`;
  return seed.target ?? "";
}

// --- one typed line -----------------------------------------------------------

export type SeedLine = {
  /** The line as typed, trimmed. Identifies the line for a type override. */
  text: string;
  /** Types this line could be sent as, the suggested one first. */
  choices: SeedKind[];
  kind: SeedKind;
  seed: SeedInput | null;
  error: string | null;
};

function looksLikeAddress(text: string): boolean {
  return !/\s/.test(text) && (/^https?:\/\//i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(text));
}

/**
 * Reads one line. "keyword | address" is a keyword + page URL. An address
 * with a path is a page; a bare domain is suggested as a whole website (and
 * can be switched to its home page). Anything else is a keyword.
 */
export function readSeedLine(raw: string, override?: SeedKind): SeedLine {
  const text = raw.replace(/\s+/g, " ").trim();
  const pipe = text.indexOf("|");
  let choices: SeedKind[];
  let keywordPart: string = text;
  let targetPart: string = text;

  if (pipe > 0 && looksLikeAddress(text.slice(pipe + 1).trim())) {
    keywordPart = text.slice(0, pipe).trim();
    targetPart = text.slice(pipe + 1).trim();
    choices = ["keyword_url"];
  } else if (looksLikeAddress(text)) {
    const url = cleanUrl(text);
    const bare = url !== null && new URL(url).pathname === "/" && !new URL(url).search;
    choices = bare ? ["site", "url", "keyword"] : ["url", "site", "keyword"];
  } else {
    choices = ["keyword"];
  }

  const kind = override && choices.includes(override) ? override : choices[0];
  const built = buildSeed(kind, keywordPart, targetPart);
  return "error" in built
    ? { text, choices, kind, seed: null, error: built.error }
    : { text, choices, kind, seed: built, error: null };
}

/** Every non-empty line of the box, with exact repeats marked so they are sent once. */
export function readSeedText(
  text: string,
  overrides: ReadonlyMap<string, SeedKind> = new Map(),
): (SeedLine & { duplicate: boolean })[] {
  const seen = new Set<string>();
  return text
    .split(/[\n\r]+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "")
    .map((l) => {
      const line = readSeedLine(l, overrides.get(l));
      const key = line.seed ? seedKey(line.seed) : null;
      const duplicate = key !== null && seen.has(key);
      if (key) seen.add(key);
      return { ...line, duplicate };
    });
}
