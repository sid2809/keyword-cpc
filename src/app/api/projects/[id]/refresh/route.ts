import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getProject, ProjectError } from "@/lib/projects";
import { ProjectParamError } from "@/lib/project-params";
import { resolveTarget } from "@/lib/project-actions";
import { getProjectJob, refreshRequestCount, startProjectRefresh } from "@/lib/project-refresh";

/**
 * "Refresh numbers" for a project.
 *
 *   GET  /api/projects/:id/refresh   the active (or just-failed) job, if any
 *   POST /api/projects/:id/refresh   { ids: string[] } | { filters: string }, dryRun?: boolean
 *        dryRun returns { entries, requests } without starting anything.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/projects/[id]/refresh">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getProject(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job: await getProjectJob(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/refresh">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getProject(id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  try {
    const ids = await resolveTarget(id, b);
    if (b.dryRun === true) {
      return NextResponse.json({ entries: ids.length, requests: await refreshRequestCount(ids) });
    }
    const job = await startProjectRefresh(id, ids);
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof ProjectError || err instanceof ProjectParamError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
