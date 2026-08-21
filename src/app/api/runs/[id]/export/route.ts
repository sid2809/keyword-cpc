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

export async function GET(request: Request, { params }: RouteContext<"/api/runs/[id]/export">) {
  if (!(await getSession())) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const run = await getRun(id);
  if (!run) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const modeParam = url.searchParams.get("mode");
  const mode: DedupMode | undefined =
    modeParam === "intact" || modeParam === "deduped" ? modeParam : undefined;
  const columns = (url.searchParams.get("columns") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean) as ExportColumnKey[];

  const grid = await buildExportGrid(id, columns, mode);
  const filename = exportFilename(run.name, run.id, format);

  if (format === "xlsx") {
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
