import { getSession } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { iterateProjectRows } from "@/lib/project-table";
import { parseProjectQuery, ProjectParamError } from "@/lib/project-params";
import { exportFilename, gridToCsvStream, gridToXlsx, type ExportGrid } from "@/lib/export";
import { countryById } from "@/lib/countries";
import { languageName } from "@/lib/languages";

/**
 * GET /api/projects/:id/export?format=csv|xlsx&<the table's filters, sort and latest>
 * Exports what the table shows under the current filters, across all pages.
 */
const HEADER = [
  "Keyword", "Location", "Language", "Network", "Fetched", "Latest", "Avg monthly searches",
  "High top-of-page bid", "Low top-of-page bid", "Average CPC", "Competition", "Competition index", "No data",
];

const money = (micros: number | null) => (micros === null ? null : micros / 1_000_000);

export async function GET(request: Request, { params }: RouteContext<"/api/projects/[id]/export">) {
  const json = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
  if (!(await getSession())) return json(401, "unauthorized");

  const { id } = await params;
  const project = await getProject(id);
  if (!project) return json(404, "not found");

  const sp = new URL(request.url).searchParams;
  let q;
  try {
    q = parseProjectQuery(sp);
  } catch (err) {
    if (err instanceof ProjectParamError) return json(400, err.message);
    throw err;
  }
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";

  const grid: ExportGrid = {
    header: HEADER,
    body: (async function* () {
      for await (const batch of iterateProjectRows(id, q)) {
        yield batch.map((r) => [
          r.keyword,
          r.geo.length === 0 ? "Worldwide" : r.geo.map((g) => countryById(g)?.name ?? g).join(" | "),
          languageName(r.language),
          r.network === "GOOGLE_SEARCH" ? "Google Search" : "Google Search + partners",
          r.fetchedAt.slice(0, 10),
          r.latest ? "yes" : "no",
          r.noData ? null : r.avgMonthlySearches,
          money(r.highTopMicros),
          money(r.lowTopMicros),
          money(r.averageCpcMicros),
          r.competition,
          r.competitionIndex,
          r.noData ? "yes" : "no",
        ]);
      }
    })(),
  };

  const filename = exportFilename(project.name, id, format);
  if (format === "xlsx") {
    const buffer = await gridToXlsx(grid);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  return new Response(gridToCsvStream(grid), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
