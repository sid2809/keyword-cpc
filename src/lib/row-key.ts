import type { ResultRow } from "./types";

/**
 * Stable identity for a result row, shared by the table's selection state and
 * by the export endpoint that has to resolve that selection server-side.
 *
 * In "keep my list intact" mode the same keyword can appear many times, so the
 * submitted text is not unique — `position` is. In deduped mode there is one
 * row per canonical keyword and `position` is null, so the text is the key.
 *
 * Deliberately not the array index: the index changes when the table is sorted
 * or filtered, which would silently reassign selections.
 */
export function resultRowKey(row: Pick<ResultRow, "position" | "submitted">): string {
  return row.position !== null ? `p${row.position}` : `k${row.submitted}`;
}
