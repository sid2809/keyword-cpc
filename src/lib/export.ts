import "server-only";
import Papa from "papaparse";
import writeXlsxFile from "write-excel-file/node";
import { query } from "./db";
import { getResults } from "./results";
import { microsToRupees } from "./format";
import type { DedupMode, ResultRow } from "./types";

/**
 * CSV / XLSX export with column selection (PLAN.md §6).
 *
 * Two behaviours the plan calls for specifically:
 *   - in intact mode, the export carries the user's original rows and order
 *   - exporting a run that came from an uploaded sheet preserves the columns
 *     the user did not use as keywords
 */

export const EXPORT_COLUMNS = [
  { key: "submitted", label: "Keyword" },
  { key: "canonical", label: "Canonical keyword" },
  { key: "avgCpc", label: "Avg CPC (₹)" },
  { key: "lowTop", label: "Low top-of-page (₹)" },
  { key: "highTop", label: "High top-of-page (₹)" },
  { key: "volume", label: "Avg monthly searches" },
  { key: "competition", label: "Competition" },
  { key: "competitionIndex", label: "Competition index" },
  { key: "monthly", label: "Monthly volumes" },
  { key: "noData", label: "No data" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];

export const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  "submitted",
  "avgCpc",
  "lowTop",
  "highTop",
  "volume",
  "competitionIndex",
];

type Cell = string | number | null;

function valueFor(row: ResultRow, key: ExportColumnKey): Cell {
  switch (key) {
    case "submitted":
      return row.submitted;
    case "canonical":
      return row.canonical;
    case "avgCpc":
      return microsToRupees(row.averageCpcMicros);
    case "lowTop":
      return microsToRupees(row.lowTopMicros);
    case "highTop":
      return microsToRupees(row.highTopMicros);
    case "volume":
      return row.avgMonthlySearches;
    case "competition":
      return row.competition;
    case "competitionIndex":
      return row.competitionIndex;
    case "monthly":
      // Flattened so one cell stays readable in a spreadsheet.
      return row.monthlyVolumes?.map((v) => `${v.year}-${String(v.month).padStart(2, "0")}:${v.searches}`).join(" ") ?? null;
    case "noData":
      return row.noData ? "yes" : "";
    default:
      return null;
  }
}

type UploadRow = {
  filename: string;
  columns: string[];
  rows: string[][];
  keyword_column: number;
};

async function getUpload(runId: string): Promise<UploadRow | null> {
  const rows = await query<UploadRow>(
    "select filename, columns, rows, keyword_column from run_uploads where run_id = $1",
    [runId],
  );
  return rows[0] ?? null;
}

export type ExportGrid = { header: string[]; body: Cell[][] };

/**
 * Builds the export grid. When the run came from an uploaded sheet AND the mode
 * is intact, the user's original columns lead and the metrics are appended, so
 * the file they get back is their file plus data.
 */
export async function buildExportGrid(
  runId: string,
  columns: ExportColumnKey[],
  mode?: DedupMode,
): Promise<ExportGrid> {
  const selected = columns.length > 0 ? columns : DEFAULT_EXPORT_COLUMNS;
  const rows = await getResults(runId, mode);
  const metricColumns = EXPORT_COLUMNS.filter((c) => selected.includes(c.key));

  const upload = mode === "deduped" ? null : await getUpload(runId);

  if (upload && rows.length > 0 && rows[0].position !== null) {
    // Intact + uploaded: original sheet columns first, metrics appended.
    // Row order matches, because run_keywords.position was assigned from the
    // sheet's row order when the run was created.
    const header = [...upload.columns, ...metricColumns.map((c) => c.label)];
    const body = rows.map((row) => {
      const original = row.position !== null ? (upload.rows[row.position] ?? []) : [];
      const padded = [...original, ...Array(Math.max(0, upload.columns.length - original.length)).fill("")];
      return [...padded, ...metricColumns.map((c) => valueFor(row, c.key))];
    });
    return { header, body };
  }

  return {
    header: metricColumns.map((c) => c.label),
    body: rows.map((row) => metricColumns.map((c) => valueFor(row, c.key))),
  };
}

export function gridToCsv(grid: ExportGrid): string {
  return Papa.unparse([grid.header, ...grid.body.map((r) => r.map((c) => (c === null ? "" : c)))]);
}

export async function gridToXlsx(grid: ExportGrid): Promise<Buffer> {
  const sheet = [
    grid.header.map((h) => ({ value: h, fontWeight: "bold" as const })),
    ...grid.body.map((r) => r.map((c) => ({ value: c === null ? "" : c }))),
  ];
  // v4 API: writeExcelFile(data).toBuffer() — the old { buffer: true } option
  // was removed.
  return (await writeXlsxFile(sheet).toBuffer()) as Buffer;
}

/** Safe, descriptive download filename. */
export function exportFilename(runName: string | null, runId: string, ext: "csv" | "xlsx"): string {
  const base = (runName ?? `run-${runId.slice(0, 8)}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "keywords"}.${ext}`;
}
