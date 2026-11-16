import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { listProjects } from "@/lib/projects";
import { ProjectsList } from "./projects-list";

/** Projects: named lists of keywords you keep and come back to. */
export default async function ProjectsPage() {
  if (!(await getSession())) redirect("/login");
  const projects = await listProjects();

  return (
    <AppShell>
      <PageHeader
        title="Projects"
        description="Keep keywords together with their numbers. Add them from a run's results or a keyword's country panel."
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        <ProjectsList projects={projects} />
      </main>
    </AppShell>
  );
}
