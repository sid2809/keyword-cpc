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
    weighted: string | null;
  }>(
    `select r.id, r.name, r.tag, r.status, r.processed, r.total_keywords, r.created_at,
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
  }));

  return NextResponse.json({ runs });
}

type CreateBody = {
  /** Pasted text (paste tab). */
  text?: string;
  /** Pre-split keyword list (upload tab). */
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
    hasHeader: boolean;
  };
};

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = body.keywords ? parseKeywordList(body.keywords) : parseKeywordText(body.text ?? "");
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No usable keywords were found." }, { status: 400 });
  }

  const settings = withDefaults(body.settings);
  const source = body.source ?? "paste";

  const runId = await createRun({
    keywords: parsed,
    settings,
    name: body.name?.trim() || null,
    tag: body.tag?.trim() || null,
    source,
  });

  if (body.upload) {
    await query(
      `insert into run_uploads (run_id, filename, columns, rows, keyword_column, has_header)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        runId,
        body.upload.filename,
        JSON.stringify(body.upload.columns),
        JSON.stringify(body.upload.rows),
        body.upload.keywordColumn,
        body.upload.hasHeader,
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
