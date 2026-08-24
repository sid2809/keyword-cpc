import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { createRun, executeRun } from "@/lib/runner";
import { parseKeywordList, parseKeywordText } from "@/lib/keywords";
import { withDefaults } from "@/lib/run-settings";
import type { RunListItem, RunSettings } from "@/lib/types";

/** Runs are executed in-process; a single user needs no external queue. */

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await query<{
    id: string;
    name: string | null;
    tag: string | null;
    status: RunListItem["status"];
    processed: number;
    total_keywords: number;
    created_at: Date;
    saved_forever: boolean;
    weighted: string | null;
  }>(
    `select r.id, r.name, r.tag, r.status, r.processed, r.total_keywords, r.created_at, r.saved_forever,
            (select case when sum(km.avg_monthly_searches) > 0
                         then round(sum(km.high_top_micros * km.avg_monthly_searches)
                                    / sum(km.avg_monthly_searches))
                         else avg(km.high_top_micros)
                    end
               from keyword_metrics km
              where km.run_id = r.id and km.no_data = false
                and km.high_top_micros is not null) as weighted
       from runs r
      order by r.created_at desc
      limit 50`,
  );

  const runs: RunListItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tag: r.tag,
    status: r.status,
    processed: r.processed,
    total: r.total_keywords,
    createdAt: r.created_at.toISOString(),
    weightedAvgHighTopMicros: r.weighted === null ? null : Math.round(Number(r.weighted)),
    savedForever: r.saved_forever,
  }));

  return NextResponse.json({ runs });
}

type CreateBody = {
  /** Pasted text (paste tab). */
  text?: string;
  /**
   * The keyword column exactly as it appears in the sheet, blanks included.
   * Blanks must NOT be stripped by the caller: the array index becomes
   * `run_keywords.source_row`, which is how the export and the URL column find
   * the right sheet row.
   */
  keywords?: string[];
  name?: string | null;
  tag?: string | null;
  settings?: Partial<RunSettings>;
  source?: "paste" | "csv" | "xlsx";
  /** Present when the run came from an uploaded sheet. */
  upload?: {
    filename: string;
    columns: string[];
    rows: string[][];
    keywordColumn: number;
    /** Index of the URL column, or null when the user designated none. */
    urlColumn?: number | null;
    hasHeader: boolean;
  };
};

/** Longest keyword we will store. Google rejects far shorter ones anyway. */
const MAX_KEYWORD_CHARS = 500;
const MAX_LABEL_CHARS = 200;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clamp(v: unknown, max: number): string | null {
  const s = asString(v).trim();
  return s === "" ? null : s.slice(0, max);
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // `null` and arrays both parse as JSON but are not request bodies.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const body = raw as CreateBody;

  /*
   * Coerce before parsing. Every one of these shapes reached Postgres or a
   * string method and produced a 500 before validation existed: keywords as a
   * bare string, as numbers, as objects; text as a number; upload without rows.
   */
  const parsed = Array.isArray(body.keywords)
    ? parseKeywordList(body.keywords.map(asString).map((k) => k.slice(0, MAX_KEYWORD_CHARS)))
    : parseKeywordText(asString(body.text));

  if (parsed.length === 0) {
    return NextResponse.json({ error: "No usable keywords were found." }, { status: 400 });
  }

  const settings = withDefaults(
    typeof body.settings === "object" && body.settings !== null && !Array.isArray(body.settings)
      ? body.settings
      : undefined,
  );
  const source = body.source === "csv" || body.source === "xlsx" ? body.source : "paste";

  const runId = await createRun({
    keywords: parsed,
    settings,
    name: clamp(body.name, MAX_LABEL_CHARS),
    tag: clamp(body.tag, MAX_LABEL_CHARS),
    source,
  });

  /*
   * Only persist an upload that is actually well formed. A partial one used to
   * write JSON `null` into a NOT NULL jsonb column and 500 after the run had
   * already been created, leaving an orphaned run behind.
   */
  const upload = body.upload;
  const uploadIsValid =
    typeof upload === "object" &&
    upload !== null &&
    Array.isArray(upload.columns) &&
    Array.isArray(upload.rows) &&
    upload.rows.every((r) => Array.isArray(r)) &&
    Number.isInteger(upload.keywordColumn) &&
    upload.keywordColumn >= 0 &&
    upload.keywordColumn < upload.columns.length;

  if (upload && !uploadIsValid) {
    return NextResponse.json({ error: "The uploaded sheet was malformed." }, { status: 400 });
  }

  if (upload && uploadIsValid) {
    await query(
      `insert into run_uploads (run_id, filename, columns, rows, keyword_column, url_column, has_header)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [
        runId,
        clamp(upload.filename, MAX_LABEL_CHARS) ?? "upload",
        JSON.stringify(upload.columns.map(asString)),
        JSON.stringify(upload.rows),
        upload.keywordColumn,
        // Out-of-range indexes would silently read undefined, so drop them.
        Number.isInteger(upload.urlColumn) &&
        (upload.urlColumn as number) >= 0 &&
        (upload.urlColumn as number) < upload.columns.length
          ? upload.urlColumn
          : null,
        upload.hasHeader === true,
      ],
    );
  }

  // Fire and forget — the client polls /api/runs/:id/progress. Awaiting here
  // would hold the response open for the whole run.
  void executeRun(runId).catch((err) => {
    console.error(`[runner] run ${runId} failed:`, err instanceof Error ? err.message : err);
  });

  const uniqueCount = new Set(parsed.map((p) => p.normalized)).size;
  return NextResponse.json({ id: runId, submitted: parsed.length, unique: uniqueCount }, { status: 201 });
}
