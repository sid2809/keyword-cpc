"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, FolderPlus } from "lucide-react";
import { CONTROL, btn } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatInt } from "@/lib/format";

/**
 * "Add to project" dialog: pick an existing project or name a new one, then
 * add the given rows of this run (row keys) with their numbers.
 * Server side: api/projects, api/projects/[id]/keywords.
 */

type Project = { id: string; name: string; keywords: number };
const NEW = "__new__";

export function AddToProjectDialog({
  runId,
  selection,
  label,
  onClose,
}: {
  runId: string;
  /** Row keys to add. */
  selection: string[];
  /** What is being added, for the title: "3 selected rows" or a keyword. */
  label: string;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [choice, setChoice] = useState<string>(NEW);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // This dialog can sit on top of the country panel, which also closes on
      // Escape (listening on window). Stop here so only the dialog closes.
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ projects: Project[] }>) : Promise.reject(new Error())))
      .then((body) => {
        if (cancelled) return;
        setProjects(body.projects);
        if (body.projects.length > 0) setChoice(body.projects[0].id);
      })
      .catch(() => !cancelled && setError("Could not load your projects."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let projectId = choice;
      let projectName = projects?.find((p) => p.id === choice)?.name ?? "";
      if (choice === NEW) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        const body = (await res.json().catch(() => null)) as { error?: string; project?: Project } | null;
        if (!res.ok || !body?.project) throw new Error(body?.error ?? "Could not create the project.");
        projectId = body.project.id;
        projectName = body.project.name;
      }
      const res = await fetch(`/api/projects/${projectId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, selection }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; added?: number; existing?: number; updated?: number }
        | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `Could not add to the project (${res.status}).`);

      const added = body.added ?? 0;
      const existing = body.existing ?? 0;
      const parts = [`Added ${formatInt(added)} ${added === 1 ? "keyword" : "keywords"} to "${projectName}"`];
      if (existing > 0) parts.push(`${formatInt(existing)} already there`);
      toast.success(parts.join(" · ") + ".");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canSubmit = !busy && projects !== null && (choice !== NEW || newName.trim() !== "");

  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        className="dialog-in w-full max-w-md rounded-[var(--radius-card)] border border-border bg-raised shadow-overlay"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="add-project-title" className="flex items-center gap-2 text-sm font-semibold text-text">
            <FolderPlus size={15} aria-hidden />
            <span className="truncate">Add {label} to a project</span>
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Saved with the numbers and settings of this run. A keyword already in the project under the same settings
            is not duplicated.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <div role="radiogroup" aria-label="Project" className="max-h-72 space-y-1.5 overflow-auto px-5 py-4">
            {projects === null && !error && <p className="text-sm text-text-muted">Loading projects…</p>}
            {(projects ?? []).map((p) => (
              <label
                key={p.id}
                className={
                  "flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 " +
                  (choice === p.id ? "border-accent bg-accent-soft" : "border-border hover:bg-subtle")
                }
              >
                <input
                  type="radio"
                  name="project"
                  checked={choice === p.id}
                  onChange={() => setChoice(p.id)}
                  className="accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-text">{p.name}</span>
                <span className="num text-xs text-text-muted">{formatInt(p.keywords)}</span>
              </label>
            ))}
            {projects !== null && (
              <label
                className={
                  "flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 " +
                  (choice === NEW ? "border-accent bg-accent-soft" : "border-border hover:bg-subtle")
                }
              >
                <input
                  type="radio"
                  name="project"
                  checked={choice === NEW}
                  onChange={() => setChoice(NEW)}
                  aria-label="New project"
                  className="accent-[var(--accent)]"
                />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onFocus={() => setChoice(NEW)}
                  maxLength={80}
                  placeholder="New project name"
                  aria-label="New project name"
                  className={`${CONTROL} h-8 min-w-0 flex-1`}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="fade-in flex items-center gap-2 pt-1 text-xs text-heat-red">
                <CircleAlert size={13} aria-hidden />
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onClose} className={btn("secondary", "sm")}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className={btn("primary", "sm")}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
