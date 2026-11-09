import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import { withDefaults } from "@/lib/run-settings";
import { getResultsPage } from "@/lib/results-table";
import { parseResultsQuery, ResultsParamError } from "@/lib/results-params";

/**
 * One page of a finished run's results table, filtered and sorted in Postgres.
 *
 *   GET /api/runs/:id/results?page=1&pageSize=100&sort=highTop&dir=desc&q=…
 *
 * Query parameters are documented in results-params.ts. Malformed ones are a
 * 400, never ignored. The dedup mode is the run's own setting, so this always
 * agrees with what the results page shows.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/runs/[id]/results">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "done") {
    return NextResponse.json({ error: "This run has not finished yet." }, { status: 409 });
  }

  let q;
  try {
    q = parseResultsQuery(new URL(request.url).searchParams);
  } catch (err) {
    if (err instanceof ResultsParamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const page = await getResultsPage(run.id, withDefaults(run.settings).dedupMode, q);
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
