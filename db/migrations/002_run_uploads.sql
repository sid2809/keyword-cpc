-- Keeps the originally uploaded sheet alongside the run.
--
-- PLAN.md §6 requires that "XLSX export of an uploaded sheet preserves the
-- user's other columns", which means the columns we did NOT use as keywords
-- have to survive until export time. Stored as jsonb rather than re-uploading:
-- a 10k-row sheet is a few MB, and runs are small in number.

create table if not exists run_uploads (
  run_id          uuid primary key references runs (id) on delete cascade,
  filename        text not null,
  -- Header labels, in sheet order.
  columns         jsonb not null,
  -- Data rows (header excluded), each an array of cell strings.
  rows            jsonb not null,
  -- Index into `columns` that the user picked as the keyword column.
  keyword_column  integer not null,
  -- False when the sheet had no header row and we generated column labels.
  has_header      boolean not null default true,
  created_at      timestamptz not null default now()
);
