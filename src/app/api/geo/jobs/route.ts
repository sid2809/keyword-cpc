import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listGeoJobs } from "@/lib/geo-breakdown";

/** GET /api/geo/jobs — breakdown jobs in progress (and recently failed). */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ jobs: await listGeoJobs() }, { headers: { "Cache-Control": "no-store" } });
}
