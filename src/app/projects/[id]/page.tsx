import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BTN_PRIMARY, Card, EmptyState, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { formatDateTime, formatInt } from "@/lib/format";

/** One project. The keyword table and actions arrive in the next steps. */
export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  if (!(await getSession())) redirect("/login");
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

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
        <Card>
          <EmptyState
            icon={<FolderKanban size={22} aria-hidden />}
            title="No keywords in this project yet"
            body="Open a run, select rows or click a keyword, and add them to this project."
            action={
              <Link href="/runs" className={BTN_PRIMARY}>
                Go to runs
              </Link>
            }
          />
        </Card>
      </main>
    </AppShell>
  );
}
