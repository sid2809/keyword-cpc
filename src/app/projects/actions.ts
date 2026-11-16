"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createProject, deleteProject, ProjectError, renameProject } from "@/lib/projects";

/**
 * Server actions for projects. Each re-checks the session (a server action is
 * a POST endpoint the page-level guard does not cover) and returns a message
 * for the user instead of throwing on bad input.
 */

export type ProjectActionState = { ok: boolean; message: string | null; id?: string };

async function run(work: () => Promise<ProjectActionState>): Promise<ProjectActionState> {
  if (!(await getSession())) return { ok: false, message: "Your session has ended. Sign in again." };
  try {
    const result = await work();
    revalidatePath("/projects");
    return result;
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function createProjectAction(_prev: ProjectActionState, formData: FormData) {
  return run(async () => {
    const project = await createProject(formData.get("name"));
    return { ok: true, message: `Created "${project.name}".`, id: project.id };
  });
}

export async function renameProjectAction(id: string, name: string) {
  return run(async () => {
    await renameProject(id, name);
    revalidatePath(`/projects/${id}`);
    return { ok: true, message: "Renamed." };
  });
}

export async function deleteProjectAction(id: string) {
  return run(async () => {
    await deleteProject(id);
    return { ok: true, message: "Project deleted." };
  });
}
