-- Optional URL column on uploaded sheets, plus a fix for row alignment.
--
-- `run_keywords.position` counts only NON-EMPTY keywords, but exports were
-- indexing `run_uploads.rows` with it. A sheet containing a blank keyword cell
-- therefore attached the wrong original row to every keyword after the gap —
-- verified: with rows [gardening tools, <blank>, lawn mower], "lawn mower" came
-- back carrying the blank row's URL and notes, and the real last row vanished.
--
-- `source_row` records the index into `run_uploads.rows` that a keyword
-- actually came from, so both the export and the new URL column resolve to the
-- right sheet row. Null for pasted runs, which have no sheet.
alter table run_keywords
  add column if not exists source_row integer;

alter table run_uploads
  -- Index into `columns` holding the destination URL, or null if the user did
  -- not designate one. Optional by design: pasted runs and sheets without URLs
  -- must be completely unaffected.
  add column if not exists url_column integer;

create index if not exists run_keywords_source_row_idx
  on run_keywords (run_id, source_row) where source_row is not null;
