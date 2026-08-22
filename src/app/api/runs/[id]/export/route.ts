import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import {
  buildExportGrid,
  exportFilename,
  gridToCsv,
  gridToXlsx,
  type ExportColumnKey,
} from "@/lib/export";
import type { DedupMode } from "@/lib/types";

type ExportOptions = {
  format: "csv" | "xlsx";
  mode: DedupMode | undefined;
  columns: ExportColumnKey[];
  selection?: string[];
};

async function respond(runId: string, opts: ExportOptions, runName: string | null) {
  const grid = await buildExportGrid(runId, opts.columns, opts.mode, opts.selection);
  const filename = exportFilename(runName, runId, opts.format);

  if (opts.format === "xlsx") {
    const buffer = await gridToXlsx(grid);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(gridToCsv(grid), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound() {
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Exporting a SELECTION uses POST, not GET: a 10,000-row selection would blow
 * past URL length limits as a query string.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/runs/[id]/export">) {
  if (!(await getSession())) return unauthorized();

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return notFound();

  let body: { format?: string; mode?: string; columns?: string[]; selection?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return respond(
    id,
    {
      format: body.format === "xlsx" ? "xlsx" : "csv",
      mode: body.mode === "intact" || body.mode === "deduped" ? body.mode : undefined,
      columns: (body.columns ?? []) as ExportColumnKey[],
      selection: Array.isArray(body.selection) ? body.selection.map(String) : undefined,
    },
    run.name,
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/runs/[id]/export">) {
  if (!(await getSession())) return unauthorized();

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return notFound();

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const modeParam = url.searchParams.get("mode");
  const mode: DedupMode | undefined =
    modeParam === "intact" || modeParam === "deduped" ? modeParam : undefined;
  const columns = (url.searchParams.get("columns") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean) as ExportColumnKey[];

  return respond(id, { format, mode, columns }, run.name);
}
