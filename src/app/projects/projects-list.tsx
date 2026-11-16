"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, FolderKanban, Pencil, Plus, Trash2, X } from "lucide-react";
import { CARD, CARD_HOVER, CONTROL, Card, EmptyState, btn } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatDateTime, formatInt } from "@/lib/format";
import type { ProjectSummary } from "@/lib/projects";
import {
  createProjectAction,
  deleteProjectAction,
  renameProjectAction,
  type ProjectActionState,
} from "./actions";

const INITIAL: ProjectActionState = { ok: false, message: null };
const NAME_MAX = 80;

export function ProjectsList({ projects }: { projects: ProjectSummary[] }) {
  const [state, action, creating] = useActionState(createProjectAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form ref={formRef} action={action} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <label htmlFor="project-name" className="text-xs font-medium text-text-secondary">
              New project
            </label>
            <input
              id="project-name"
              name="name"
              required
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder="e.g. Travel keywords, Q1"
              aria-describedby={state.message && !state.ok ? "project-create-error" : undefined}
              className={CONTROL}
            />
          </div>
          <button type="submit" disabled={creating} className={btn("primary")}>
            <Plus size={15} aria-hidden />
            {creating ? "Creating…" : "Create project"}
          </button>
        </form>
        {state.message && !state.ok && (
          <p id="project-create-error" role="alert" className="fade-in mt-2 text-sm text-heat-red">
            {state.message}
          </p>
        )}
      </Card>

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban size={22} aria-hidden />}
            title="No projects yet"
            body="Create one above, then add keywords to it from any run's results."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function rename() {
    startTransition(async () => {
      const res = await renameProjectAction(project.id, name);
      if (res.ok) {
        setMode("view");
        setError(null);
        toast.success("Project renamed.");
      } else setError(res.message);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteProjectAction(project.id);
      if (res.ok) toast.success(`Deleted "${project.name}".`);
      else {
        setError(res.message);
        setMode("view");
      }
    });
  }

  return (
    <li className={`${CARD} ${mode === "view" ? CARD_HOVER : ""} flex flex-col p-4`}>
      {mode === "rename" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
          className="flex items-center gap-2"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            aria-label={`New name for ${project.name}`}
            className={`${CONTROL} min-w-0 flex-1`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setMode("view");
                setName(project.name);
                setError(null);
              }
            }}
          />
          <button type="submit" disabled={pending} aria-label="Save name" className={btn("primary", "icon")}>
            <Check size={15} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Cancel rename"
            onClick={() => {
              setMode("view");
              setName(project.name);
              setError(null);
            }}
            className={btn("ghost", "icon")}
          >
            <X size={15} aria-hidden />
          </button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/projects/${project.id}`}
            className="min-w-0 flex-1 truncate text-sm font-semibold text-text hover:text-accent"
            title={project.name}
          >
            {project.name}
          </Link>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label={`Rename ${project.name}`}
              title="Rename"
              onClick={() => setMode("rename")}
              className={btn("ghost", "icon")}
            >
              <Pencil size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Delete ${project.name}`}
              title="Delete"
              onClick={() => setMode("delete")}
              className={btn("ghost", "icon")}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <p className="num mt-2 text-2xl font-semibold tracking-tight text-text">{formatInt(project.keywords)}</p>
      <p className="text-xs text-text-secondary">{project.keywords === 1 ? "keyword" : "keywords"}</p>
      <p className="mt-3 text-xs text-text-muted">Updated {formatDateTime(project.updatedAt)}</p>

      {error && (
        <p role="alert" className="fade-in mt-2 text-xs text-heat-red">
          {error}
        </p>
      )}

      {mode === "delete" && (
        <div className="fade-in mt-3 rounded-[var(--radius-control)] border border-heat-red/30 bg-heat-red-soft p-3">
          <p className="text-xs text-text">
            Delete this project
            {project.keywords > 0
              ? ` and its ${formatInt(project.keywords)} saved ${project.keywords === 1 ? "keyword" : "keywords"}, including their history`
              : ""}
            ? Runs are not affected.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={remove} disabled={pending} className={`${btn("secondary", "sm")} text-heat-red`}>
              {pending ? "Deleting…" : "Delete project"}
            </button>
            <button type="button" onClick={() => setMode("view")} className={btn("secondary", "sm")}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
