-- Results at scale: the results page now reads one page of rows at a time
-- from Postgres instead of loading the whole run into the browser.
--
-- Measured before this change on a 125,000-keyword run: the results page
-- rendered a 308 MB HTML response in 25 s on the server, then asked the
-- browser to draw 125,000 table rows — which is what froze the tab.
--
-- The URL column was the one piece of a result row that could not be read
-- per row: it lived inside `run_uploads.rows`, a single jsonb array holding the
-- entire sheet, so showing ANY row meant loading EVERY row. It is now copied
-- onto the keyword it belongs to.

-- Alphabetical order and case-insensitive search move from the browser into
-- SQL, so the database has to order and lowercase text the way JavaScript did.
-- The database's default collation cannot be relied on for that: under "C"
-- (a common default) "KEYWORD 100" sorts before "keyword 1". The ICU root
-- collation reproduced String.prototype.localeCompare exactly on a 127,678
-- string test corpus (seeded keywords plus mixed case, accents, CJK, Arabic,
-- Cyrillic, ligatures and emoji), and ICU lower() matched toLowerCase() on
-- every BMP code point except 8 letters added in Unicode 16–17.
--
-- Requires a Postgres built with ICU (the official images are). Without it
-- this statement fails and the migration stops, rather than silently sorting
-- differently.
create collation if not exists keyword_order (provider = icu, locale = 'und');

alter table run_keywords
  -- Destination URL from the uploaded sheet's URL column, or null when the run
  -- was pasted, the sheet had no URL column, or the cell was blank.
  add column if not exists url text;

-- Covering indexes for the results table. Sorting and filtering a page reads
-- only these narrow columns; the wide ones (monthly volumes, previous values,
-- URL) are fetched afterwards for the rows on the page alone. Without them
-- Postgres scanned keyword_metrics in full — every run's rows, ~1 KB each —
-- and sorted full-width rows, spilling ~127 MB to disk per page request on a
-- 125,000-keyword run.
create index if not exists keyword_metrics_table_idx
  on keyword_metrics (run_id, canonical_text)
  include (high_top_micros, low_top_micros, average_cpc_micros, avg_monthly_searches,
           competition, competition_index, no_data);

-- Deduped runs read in alphabetical order (keyword_order, above) for export and
-- as the tie-break of every deduped sort; this index serves that order directly
-- instead of sorting the run each time.
create index if not exists keyword_metrics_alpha_idx
  on keyword_metrics (run_id, (canonical_text collate keyword_order));

-- Supersedes run_keywords_run_position_idx (same key columns), so that one is
-- dropped rather than kept as a second index to maintain on every insert.
create index if not exists run_keywords_table_idx
  on run_keywords (run_id, position)
  include (submitted_text, canonical_text);
drop index if exists run_keywords_run_position_idx;

-- Backfill existing runs from their stored sheet, matching the rule the app
-- used at read time (results.ts `urlAt`): the cell at
-- rows[source_row][url_column], trimmed, with an empty result meaning "no URL".
--
-- The trim class is JavaScript's String.prototype.trim set (WhiteSpace plus
-- LineTerminator, ECMA-262 §22.1.3.32), not Postgres's btrim(), which only
-- strips spaces — so backfilled values are identical to what the old code
-- displayed.
--
-- Each sheet is expanded ONCE with jsonb_array_elements and joined on the row
-- index. Indexing into the jsonb per keyword (`u.rows -> k.source_row`) would
-- re-read the whole sheet for every keyword — tried, and on a 125,000-row sheet
-- it was still running after five minutes.
update run_keywords k
   set url = nullif(
         regexp_replace(
           s.cell,
           '^[\u0009-\u000D    -     　﻿]+|[\u0009-\u000D    -     　﻿]+$',
           '',
           'g'
         ),
         ''
       )
  from (
    select u.run_id,
           (e.ordinality - 1)::integer as source_row,
           e.value ->> u.url_column    as cell
      from run_uploads u
     cross join lateral jsonb_array_elements(u.rows) with ordinality as e(value, ordinality)
     where u.url_column is not null
  ) s
 where s.run_id = k.run_id
   and s.source_row = k.source_row;

-- Fresh planner statistics for the new indexes and the backfilled column.
-- (The runner now does the same after every run; see runner.ts.)
analyze run_keywords;
analyze keyword_metrics;
