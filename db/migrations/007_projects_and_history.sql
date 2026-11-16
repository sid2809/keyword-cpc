-- Projects, and permanent history for country breakdowns.

-- 1. Country breakdowns are kept forever, one row per FETCH (was: one row per
--    keyword/network/country, treated as stale after the calendar month).
--    job_id ties the rows of one fetch together; force marks a refresh job,
--    which re-asks countries that already have an answer.
alter table keyword_geo_metrics drop constraint if exists keyword_geo_metrics_pkey;
alter table keyword_geo_metrics add column if not exists id bigserial primary key;
alter table keyword_geo_metrics add column if not exists job_id uuid;
create index if not exists keyword_geo_metrics_lookup_idx
  on keyword_geo_metrics (keyword, network, geo, fetched_at desc);
alter table geo_jobs add column if not exists force boolean not null default false;

-- 2. Projects: named lists of keywords. An entry is a keyword TOGETHER WITH the
--    settings it was fetched under (location, language, network), so the same
--    keyword from a US run and an India run are two entries. A keyword can be
--    in any number of projects.
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text not null
);
create unique index if not exists projects_name_idx on projects (lower(name));

create table if not exists project_keywords (
  id             bigserial primary key,
  project_id     uuid not null references projects (id) on delete cascade,
  keyword        text not null,                 -- as submitted, original casing
  keyword_key    text not null,                 -- lower-cased, for matching
  settings       jsonb not null,                -- { geoTargetConstants, language, network }
  settings_hash  text not null,                 -- run-settings.ts settingsHash()
  source_run_id  uuid references runs (id) on delete set null,
  added_at       timestamptz not null default now(),
  unique (project_id, keyword_key, settings_hash)
);

-- Every fetch of an entry's numbers is kept; the newest is "latest".
create table if not exists project_keyword_fetches (
  id                    bigserial primary key,
  project_keyword_id    bigint not null references project_keywords (id) on delete cascade,
  fetched_at            timestamptz not null default now(),
  canonical_text        text,
  no_data               boolean not null,
  avg_monthly_searches  bigint,
  high_top_micros       bigint,
  low_top_micros        bigint,
  average_cpc_micros    bigint,
  competition           text,
  competition_index     integer,
  monthly_volumes       jsonb
);
create index if not exists project_keyword_fetches_latest_idx
  on project_keyword_fetches (project_keyword_id, fetched_at desc);
