-- Country breakdown for keywords (click a keyword / "Get geographical breakdown").
--
-- Google's API has no per-country breakdown, so the app asks once per country.
-- keyword_geo_metrics holds one row per (keyword, network, country) that was
-- asked, INCLUDING keywords Google returned nothing for (no_data = true), so
-- "asked, no data" can be told apart from "not asked yet".
-- Rows fetched in the current calendar month count as fresh (Google refreshes
-- monthly; same rule as metrics_cache).

create table if not exists keyword_geo_metrics (
  keyword               text not null,          -- lower-cased, as submitted
  network               text not null,          -- GOOGLE_SEARCH | GOOGLE_SEARCH_AND_PARTNERS
  geo                   text not null,          -- geoTargetConstants/<id>
  no_data               boolean not null,
  avg_monthly_searches  bigint,
  high_top_micros       bigint,
  low_top_micros        bigint,
  average_cpc_micros    bigint,
  competition           text,
  competition_index     integer,
  fetched_at            timestamptz not null default now(),
  primary key (keyword, network, geo)
);

-- One background job = one list of keywords x one list of countries.
-- `cursor` is the next country index to fetch, so a restart resumes mid-job.
create table if not exists geo_jobs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  keywords    text[] not null,
  network     text not null,
  scope       text not null check (scope in ('shortlist', 'all')),
  countries   text[] not null,
  cursor      integer not null default 0,
  status      text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed')),
  error       text
);

create index if not exists geo_jobs_active_idx on geo_jobs (created_at) where status in ('queued', 'running');
