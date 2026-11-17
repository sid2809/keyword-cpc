-- Discover: find new keywords from seeds (a keyword, a page URL, a keyword +
-- URL, or a whole site) with Google's keyword-ideas request.
--
-- A discovery is stored as a run so the results table, filters, export,
-- projects and country breakdown work on it unchanged: every idea is a
-- run_keywords row with its numbers in keyword_metrics. Each row also records
-- which seed produced it, because Google's reply does not (VERIFIED.md §9).
--
-- Only adds things. Existing runs are not rewritten: the new columns are
-- nullable with no default, so Postgres changes the table definition only.

-- runs.source gains 'discover'. The constraint is replaced, not altered:
-- Postgres has no "add a value to a check constraint".
alter table runs drop constraint if exists runs_source_check;
alter table runs add constraint runs_source_check
  check (source in ('paste', 'csv', 'xlsx', 'discover'));

alter table runs
  -- Most ideas to keep per seed; null = everything Google returns.
  add column if not exists idea_limit integer check (idea_limit is null or idea_limit >= 1);

create table if not exists run_seeds (
  run_id       uuid not null references runs (id) on delete cascade,
  position     integer not null,              -- order the seeds were entered in
  kind         text not null check (kind in ('keyword', 'url', 'keyword_url', 'site')),
  keyword      text,                          -- kinds keyword, keyword_url
  target       text,                          -- the URL (url, keyword_url) or the site (site)
  -- pending: not asked yet. done: asked and stored. failed: Google rejected
  -- this seed (HTTP 400), so asking again would fail the same way.
  status       text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  ideas_total  integer,                       -- Google's totalSize for this seed
  ideas_kept   integer not null default 0,
  truncated    boolean not null default false, -- the limit cut the list short
  requests     integer not null default 0,
  error        text,
  fetched_at   timestamptz,
  primary key (run_id, position)
);

alter table run_keywords
  -- run_seeds.position of the seed that produced this row; null on normal runs.
  add column if not exists seed_position integer;

create index if not exists run_keywords_seed_idx
  on run_keywords (run_id, seed_position) where seed_position is not null;
