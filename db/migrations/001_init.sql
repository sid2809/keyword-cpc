-- Phase 0 schema. Mirrors PLAN.md §4.
-- `jobs` is folded into `runs` (the plan marks it optional): `chunk_cursor`
-- lives on the run so a restart can resume mid-run without a second table.

create table if not exists runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  name            text,
  tag             text,                       -- niche/site label, e.g. "ponly gardening"
  source          text not null check (source in ('paste', 'csv', 'xlsx')),
  settings        jsonb not null default '{}'::jsonb,  -- geo, language, network, date range, dedup mode
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  total_keywords  integer not null default 0,
  processed       integer not null default 0,
  chunk_cursor    integer not null default 0, -- next chunk index to fetch; resume point
  saved_forever   boolean not null default false,
  error           text
);

create index if not exists runs_created_at_idx on runs (created_at desc);
create index if not exists runs_status_idx on runs (status) where status in ('queued', 'running');
create index if not exists runs_tag_idx on runs (tag) where tag is not null;

create table if not exists run_keywords (
  id              bigserial primary key,
  run_id          uuid not null references runs (id) on delete cascade,
  submitted_text  text not null,              -- exactly what the user gave, original casing
  canonical_text  text,                       -- what Google collapsed it to; null until fetched
  position        integer not null            -- original row order, for "keep list intact" mode
);

create index if not exists run_keywords_run_position_idx on run_keywords (run_id, position);
create index if not exists run_keywords_canonical_idx on run_keywords (run_id, canonical_text);

create table if not exists keyword_metrics (
  id                    bigserial primary key,
  run_id                uuid not null references runs (id) on delete cascade,
  canonical_text        text not null,
  average_cpc_micros    bigint,               -- nullable: no-data keywords
  avg_monthly_searches  bigint,
  competition           text,
  competition_index     integer,
  low_top_micros        bigint,
  high_top_micros       bigint,
  monthly_volumes       jsonb,                -- [{year, month, searches}, ...]
  no_data               boolean not null default false,
  niche_tag             text,                 -- reserved for deferred AI tagging
  unique (run_id, canonical_text)
);

create index if not exists keyword_metrics_run_idx on keyword_metrics (run_id);

-- Cross-run cache. Google refreshes this data roughly monthly, so the runner
-- reuses a payload fetched in the same calendar month before spending a call.
create table if not exists metrics_cache (
  canonical_text  text not null,
  settings_hash   text not null,              -- hash of geo + language + network + date range
  payload         jsonb not null,
  fetched_at      timestamptz not null default now(),
  primary key (canonical_text, settings_hash)
);

create index if not exists metrics_cache_fetched_at_idx on metrics_cache (fetched_at);
