-- Phase 4: refresh + delta, and persisted app settings.

-- Previous-pull values, so a refresh can show per-keyword movement
-- (PLAN.md §6: "shows per-keyword delta vs previous pull").
-- Kept as columns on the metrics row rather than a history table: the plan asks
-- for a delta against the PREVIOUS pull only, not a full time series.
alter table keyword_metrics
  add column if not exists prev_average_cpc_micros   bigint,
  add column if not exists prev_avg_monthly_searches bigint,
  add column if not exists prev_low_top_micros       bigint,
  add column if not exists prev_high_top_micros      bigint;

alter table runs
  -- A refresh must re-ask Google, so it has to skip the same-calendar-month
  -- cache rule that normally serves a repeat run for free. Persisted on the row
  -- (not passed as an argument) so a refresh interrupted by a restart resumes
  -- as a refresh rather than quietly falling back to cached values.
  add column if not exists bypass_cache  boolean not null default false,
  add column if not exists refreshed_at  timestamptz,
  add column if not exists refresh_count integer not null default 0;

create index if not exists runs_saved_forever_idx
  on runs (saved_forever) where saved_forever = true;

-- Single-row table of user-editable defaults. Env vars remain the fallback for
-- anything null here, so the app still works with an empty table.
create table if not exists app_settings (
  id                  smallint primary key default 1 check (id = 1),
  live_mode_threshold integer,
  default_geo         text,
  default_language    text,
  updated_at          timestamptz not null default now()
);

insert into app_settings (id) values (1) on conflict (id) do nothing;
