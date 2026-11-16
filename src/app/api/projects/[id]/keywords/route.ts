import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { isRunId } from "@/lib/ids";
import { ProjectError } from "@/lib/projects";
import { addRunRowsToProject } from "@/lib/project-keywords";
import { getProject } from "@/lib/projects";
import { getProjectPage, removeProjectEntries } from "@/lib/project-table";
import { parseProjectQuery, ProjectParamError } from "@/lib/project-params";

/**
 * GET /api/projects/:id/keywords?q=&geo=&lang=&net=&minVol=&minBid=&maxBid=&nodata=hide
 *     &sort=&dir=&page=&size=&latest=0
 * One page of the project's table (project-params.ts describes the query).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/projects/[id]/keywords">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getProject(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const q = parseProjectQuery(new URL(request.url).searchParams);
    return NextResponse.json(await getProjectPage(id, q), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ProjectParamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** DELETE /api/projects/:id/keywords  { ids: string[] }  removes entries and their history. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/projects/[id]/keywords">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  const removed = await removeProjectEntries(id, ids.map(String));
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return NextResponse.json({ removed });
}


/**
 * POST /api/projects/:id/keywords  { runId, selection: string[] (row keys) }
 * Adds rows of a run to the project with their numbers. Returns counts.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/keywords">) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!isRunId(b.runId)) return NextResponse.json({ error: "Run not found." }, { status: 400 });
  if (!Array.isArray(b.selection)) return NextResponse.json({ error: "No rows selected." }, { status: 400 });

  try {
    const result = await addRunRowsToProject({ projectId: id, runId: b.runId, selection: b.selection.map(String) });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.message.endsWith("not found.") ? 404 : 400 });
    }
    throw err;
  }
}
