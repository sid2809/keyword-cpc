import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { withDefaults } from "@/lib/run-settings";
import { getMatchingKeys } from "@/lib/results-table";
import { parseFilters, parseSort, ResultsParamError } from "@/lib/results-params";

/**
 * Row keys (row-key.ts) of every row matching the filters, in display order.
 *
 *   GET /api/runs/:id/results/keys?q=…&sort=…&dir=…
 *
 * The table only holds one page, but two selection actions need the rest:
 * "select all matching" and a shift-click range that runs across pages. Keys
 * are short ("p123" or "k<keyword>"), so even a 125,000-row run is a small
 * response compared with the rows themselves.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/runs/[id]/results/keys">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "done") {
    return NextResponse.json({ error: "This run has not finished yet." }, { status: 409 });
  }

  let filters;
  let sort;
  try {
    const sp = new URL(request.url).searchParams;
    filters = parseFilters(sp);
    sort = parseSort(sp);
  } catch (err) {
    if (err instanceof ResultsParamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const keys = await getMatchingKeys(run.id, withDefaults(run.settings).dedupMode, filters, sort);
  return NextResponse.json({ keys }, { headers: { "Cache-Control": "no-store" } });
}
