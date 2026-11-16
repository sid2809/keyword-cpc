import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getProject, ProjectError } from "@/lib/projects";
import { ProjectParamError } from "@/lib/project-params";
import { previewProjectGeo, resolveTarget, startProjectGeo } from "@/lib/project-actions";

/**
 * Country breakdown for project keywords.
 *
 *   POST /api/projects/:id/geo
 *        { ids: string[] } | { filters: string }, and either
 *        dryRun: true            -> { keywords, shortlistRequests, allRequests }
 *        scope: "shortlist"|"all" -> starts the job(s), { keywords }
 */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/geo">) {
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
    if (b.dryRun === true) return NextResponse.json(await previewProjectGeo(ids));
    if (b.scope !== "shortlist" && b.scope !== "all") {
      return NextResponse.json({ error: "scope must be shortlist or all." }, { status: 400 });
    }
    return NextResponse.json({ keywords: await startProjectGeo(ids, b.scope) }, { status: 202 });
  } catch (err) {
    if (err instanceof ProjectError || err instanceof ProjectParamError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
