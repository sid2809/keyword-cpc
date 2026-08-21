import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRun } from "@/lib/runner";
import type { RunProgress } from "@/lib/types";

/** Polled by the progress bar. Cheap: one row by primary key. */
export async function GET(_request: Request, { params }: RouteContext<"/api/runs/[id]/progress">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const progress: RunProgress = {
    id: run.id,
    status: run.status,
    processed: run.processed,
    total: run.total_keywords,
    error: run.error,
  };
  return NextResponse.json(progress, {
    // Never let a proxy or the router cache an in-flight progress reading.
    headers: { "Cache-Control": "no-store" },
  });
}
