import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { formatDateTime, formatInt } from "@/lib/format";
import { getProjectFacets, getProjectPage } from "@/lib/project-table";
import { DEFAULT_PROJECT_QUERY } from "@/lib/project-params";
import { ProjectView } from "./project-view";

/** One project: its keyword table (project-view.tsx). */
export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  if (!(await getSession())) redirect("/login");
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [initialPage, facets] = await Promise.all([
    getProjectPage(project.id, DEFAULT_PROJECT_QUERY),
    getProjectFacets(project.id),
  ]);

  return (
    <AppShell>
      <PageHeader
        breadcrumb={
          <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
            <Link href="/projects" className="font-medium hover:text-text">
              Projects
            </Link>
            <span className="mx-1.5 text-text-muted" aria-hidden>
              /
            </span>
            <span className="text-text-muted">{project.name}</span>
          </nav>
        }
        title={project.name}
        meta={`${formatInt(project.keywords)} ${project.keywords === 1 ? "keyword" : "keywords"} · updated ${formatDateTime(project.updatedAt)}`}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        <ProjectView projectId={project.id} initialPage={initialPage} facets={facets} />
      </main>
    </AppShell>
  );
}
