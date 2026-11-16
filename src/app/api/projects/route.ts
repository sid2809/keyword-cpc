import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createProject, listProjects, ProjectError } from "@/lib/projects";

/**
 *   GET  /api/projects            list, for the "Add to project" picker
 *   POST /api/projects { name }   create one on the spot
 */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ projects: await listProjects() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  try {
    const project = await createProject((body as { name?: unknown } | null)?.name);
    revalidatePath("/projects");
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof ProjectError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
