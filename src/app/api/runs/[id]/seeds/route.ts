import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRunSeeds } from "@/lib/discover";
import { getRun } from "@/lib/runner";

/** The seeds of a discovery and what each one returned. Empty for a normal run. */
export async function GET(_request: Request, { params }: RouteContext<"/api/runs/[id]/seeds">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getRun(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ seeds: await getRunSeeds(id) }, { headers: { "Cache-Control": "no-store" } });
}
