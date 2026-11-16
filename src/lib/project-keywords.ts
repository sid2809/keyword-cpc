import "server-only";
import { getPool } from "./db";
import { chunk } from "./keywords";
import { getProject, ProjectError } from "./projects";
import { iterateResultRows } from "./results-table";
import { getRun } from "./runner";
import { settingsHash, withDefaults } from "./run-settings";
import type { ResultRow } from "./types";

/**
 * Keywords inside projects (migration 007).
 *
 * An entry is a keyword plus the settings it was fetched under (location,
 * language, network), taken from the run it is added from. Its numbers are
 * stored as a dated fetch; every later fetch is kept too.
 */

export type AddResult = {
  /** Entries created. */
  added: number;
  /** Rows whose keyword + settings were already in the project. */
  existing: number;
  /** Of those, how many gained a newer set of numbers from this run. */
  updated: number;
};

const BATCH = 1000;

/**
 * Adds rows of a finished run to a project, with the numbers the run holds.
 *
 * `selection` is row keys (row-key.ts), as for a selection export. The numbers
 * are dated with the run's last pull (its refresh time, or when it was made).
 * A keyword already in the project under the same settings is not duplicated;
 * it gains a fetch only if this run's numbers are newer than its latest.
 */
export async function addRunRowsToProject(input: {
  projectId: string;
  runId: string;
  selection: string[];
}): Promise<AddResult> {
  const project = await getProject(input.projectId);
  if (!project) throw new ProjectError("Project not found.");
  const run = await getRun(input.runId);
  if (!run) throw new ProjectError("Run not found.");
  if (run.status !== "done") throw new ProjectError("This run has not finished yet.");
  if (input.selection.length === 0) throw new ProjectError("No rows selected.");

  const settings = withDefaults(run.settings);
  const stored = {
    geoTargetConstants: settings.geoTargetConstants,
    language: settings.language,
    network: settings.network,
  };
  const hash = settingsHash(settings);
  const pulledAt = run.refreshed_at ?? run.created_at;

  // One row per keyword: in "intact" mode a run can list the same keyword twice.
  const byKey = new Map<string, ResultRow>();
  for await (const batch of iterateResultRows(run.id, settings.dedupMode, input.selection)) {
    for (const { row } of batch) {
      const key = row.submitted.trim().toLowerCase();
      if (key !== "" && !byKey.has(key)) byKey.set(key, row);
    }
  }
  if (byKey.size === 0) throw new ProjectError("No rows matched the selection.");

  const result: AddResult = { added: 0, existing: 0, updated: 0 };
  const client = await getPool().connect();
  try {
    await client.query("begin");
    for (const batch of chunk([...byKey.entries()], BATCH)) {
      const keys = batch.map(([key]) => key);

      const inserted = await client.query<{ id: string; keyword_key: string }>(
        `insert into project_keywords (project_id, keyword, keyword_key, settings, settings_hash, source_run_id)
         select $1, t.keyword, t.key, $2::jsonb, $3, $4
           from unnest($5::text[], $6::text[]) as t(keyword, key)
         on conflict (project_id, keyword_key, settings_hash) do nothing
         returning id, keyword_key`,
        [project.id, JSON.stringify(stored), hash, run.id, batch.map(([, row]) => row.submitted.trim()), keys],
      );
      const isNew = new Set(inserted.rows.map((r) => r.keyword_key));

      // Entries (new and existing) that should receive this run's numbers.
      const targets = await client.query<{ id: string; keyword_key: string }>(
        `select pk.id, pk.keyword_key
           from project_keywords pk
          where pk.project_id = $1 and pk.settings_hash = $2 and pk.keyword_key = any($3::text[])
            and not exists (
              select 1 from project_keyword_fetches f
               where f.project_keyword_id = pk.id and f.fetched_at >= $4
            )`,
        [project.id, hash, keys, pulledAt],
      );

      result.added += isNew.size;
      result.existing += keys.length - isNew.size;
      result.updated += targets.rows.filter((t) => !isNew.has(t.keyword_key)).length;

      if (targets.rows.length > 0) {
        const values: unknown[] = [];
        const tuples = targets.rows.map((t, i) => {
          const row = byKey.get(t.keyword_key)!;
          values.push(
            t.id,
            pulledAt,
            row.canonical,
            row.noData,
            row.avgMonthlySearches,
            row.highTopMicros,
            row.lowTopMicros,
            row.averageCpcMicros,
            row.competition,
            row.competitionIndex,
            row.monthlyVolumes === null ? null : JSON.stringify(row.monthlyVolumes),
          );
          const b = i * 11;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}::jsonb)`;
        });
        await client.query(
          `insert into project_keyword_fetches
             (project_keyword_id, fetched_at, canonical_text, no_data, avg_monthly_searches, high_top_micros,
              low_top_micros, average_cpc_micros, competition, competition_index, monthly_volumes)
           values ${tuples.join(", ")}`,
          values,
        );
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return result;
}
