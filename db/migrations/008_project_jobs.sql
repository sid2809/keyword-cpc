-- "Refresh numbers" jobs for projects. A job lists the entries to re-fetch;
-- an entry is done once it has a fetch newer than the job, so a restart
-- simply continues with whatever is left (no cursor needed).
create table if not exists project_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  entry_ids       bigint[] not null,
  requests_total  integer not null,
  requests_done   integer not null default 0,
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'done', 'failed')),
  error           text
);
-- At most one active job per project (also what makes "already running" race-free).
create unique index if not exists project_jobs_active_idx on project_jobs (project_id) where status in ('queued', 'running');
