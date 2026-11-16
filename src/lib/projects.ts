import "server-only";
import { query } from "./db";
import { isRunId } from "./ids";

/**
 * Projects: named lists of keywords (migration 007). An entry in a project is
 * a keyword together with the settings it was fetched under; see
 * project_keywords. This module owns the project records themselves.
 */

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  /** Latest of: project edited, keyword added, numbers fetched. */
  updatedAt: string;
  keywords: number;
};

export const PROJECT_NAME_MAX = 80;

export class ProjectError extends Error {}

/** Trims and validates a name; throws ProjectError with a message for the user. */
export function cleanProjectName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name === "") throw new ProjectError("Give the project a name.");
  if (name.length > PROJECT_NAME_MAX) throw new ProjectError(`Keep the name under ${PROJECT_NAME_MAX} characters.`);
  if (name.includes("\u0000")) throw new ProjectError("That name contains a character that can't be stored.");
  return name;
}

const SUMMARY = `
  select p.id, p.name, p.created_at,
         greatest(p.updated_at, coalesce(k.last_added, p.updated_at), coalesce(k.last_fetched, p.updated_at)) as updated_at,
         coalesce(k.n, 0)::int as keywords
    from projects p
    left join lateral (
      select count(*) as n, max(pk.added_at) as last_added,
             (select max(f.fetched_at) from project_keyword_fetches f
               join project_keywords pk2 on pk2.id = f.project_keyword_id
              where pk2.project_id = p.id) as last_fetched
        from project_keywords pk where pk.project_id = p.id
    ) k on true`;

type Row = { id: string; name: string; created_at: Date; updated_at: Date; keywords: number };
const toSummary = (r: Row): ProjectSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  keywords: r.keywords,
});

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await query<Row>(`${SUMMARY} order by updated_at desc, p.name asc`);
  return rows.map(toSummary);
}

export async function getProject(id: string): Promise<ProjectSummary | null> {
  if (!isRunId(id)) return null;
  const rows = await query<Row>(`${SUMMARY} where p.id = $1`, [id]);
  return rows[0] ? toSummary(rows[0]) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function createProject(rawName: unknown): Promise<ProjectSummary> {
  const name = cleanProjectName(rawName);
  try {
    const rows = await query<{ id: string }>("insert into projects (name) values ($1) returning id", [name]);
    return (await getProject(rows[0].id))!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProjectError(`A project called "${name}" already exists.`);
    throw err;
  }
}

export async function renameProject(id: string, rawName: unknown): Promise<void> {
  if (!isRunId(id)) throw new ProjectError("Project not found.");
  const name = cleanProjectName(rawName);
  try {
    const rows = await query<{ id: string }>(
      "update projects set name = $2, updated_at = now() where id = $1 returning id",
      [id, name],
    );
    if (rows.length === 0) throw new ProjectError("Project not found.");
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProjectError(`A project called "${name}" already exists.`);
    throw err;
  }
}

/** Deletes the project and its keywords and their fetch history (cascade). */
export async function deleteProject(id: string): Promise<void> {
  if (!isRunId(id)) throw new ProjectError("Project not found.");
  await query("delete from projects where id = $1", [id]);
}
