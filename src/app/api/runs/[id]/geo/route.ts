import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { withDefaults } from "@/lib/run-settings";
import { iterateResultRows } from "@/lib/results-table";
import { MAX_GEO_KEYWORDS, normalizeGeoKeywords, startGeoJob } from "@/lib/geo-breakdown";

/**
 * Country breakdown for SELECTED rows of a run.
 *
 *   POST /api/runs/:id/geo  { selection: string[] (row keys), scope: "shortlist" | "all" }
 *
 * The browser only holds row keys (a selection can span pages), so the
 * keywords are resolved here, the same way a selection export does it.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/runs/[id]/geo">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "done") {
    return NextResponse.json({ error: "This run has not finished yet." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (b.scope !== "shortlist" && b.scope !== "all") {
    return NextResponse.json({ error: "scope must be shortlist or all." }, { status: 400 });
  }
  if (!Array.isArray(b.selection) || b.selection.length === 0) {
    return NextResponse.json({ error: "No rows selected." }, { status: 400 });
  }

  const settings = withDefaults(run.settings);
  const submitted: string[] = [];
  for await (const batch of iterateResultRows(run.id, settings.dedupMode, b.selection.map(String))) {
    for (const { row } of batch) submitted.push(row.submitted);
  }
  const keywords = normalizeGeoKeywords(submitted);
  if (keywords.length === 0) return NextResponse.json({ error: "No rows matched the selection." }, { status: 400 });
  if (keywords.length > MAX_GEO_KEYWORDS) {
    return NextResponse.json(
      { error: `At most ${MAX_GEO_KEYWORDS.toLocaleString("en-IN")} keywords per breakdown; ${keywords.length.toLocaleString("en-IN")} selected.` },
      { status: 400 },
    );
  }

  const job = await startGeoJob({ keywords, network: settings.network, scope: b.scope });
  return NextResponse.json({ jobId: job.id, keywords: keywords.length }, { status: 202 });
}
