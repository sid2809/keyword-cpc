import "server-only";
import Papa from "papaparse";
import writeXlsxFile from "write-excel-file/node";
import { query } from "./db";
import { iterateResultRows } from "./results-table";
import { microsToRupees } from "./format";
import type { DedupMode, ResultRow } from "./types";

/**
 * CSV / XLSX export with column selection (PLAN.md §6).
 *
 * Two behaviours the plan calls for specifically:
 *   - in intact mode, the export carries the user's original rows and order
 *   - exporting a run that came from an uploaded sheet preserves the columns
 *     the user did not use as keywords
 *
 * Rows are read in batches (results-table.ts iterateResultRows) rather than
 * all at once, and CSV is streamed to the client batch by batch, so a large
 * run is never held in memory as both result rows and output. The bytes
 * produced are identical to the previous all-at-once implementation — checked
 * against its output on a 125,000-keyword run.
 */

export const EXPORT_COLUMNS = [
  { key: "submitted", label: "Keyword" },
  { key: "canonical", label: "Canonical keyword" },
  // The top-of-page band is the primary metric (VERIFIED.md §7); avg CPC
  // follows it as secondary information.
  { key: "lowTop", label: "Low top-of-page (₹)" },
  { key: "highTop", label: "High top-of-page (₹)" },
  { key: "avgCpc", label: "Avg CPC (₹, info)" },
  { key: "url", label: "URL" },
  { key: "volume", label: "Avg monthly searches" },
  { key: "competition", label: "Competition" },
  { key: "competitionIndex", label: "Competition index" },
  { key: "monthly", label: "Monthly volumes" },
  { key: "noData", label: "No data" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];

export const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  "submitted",
  "lowTop",
  "highTop",
  "avgCpc",
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
    case "url":
      // All distinct URLs, so a deduped row loses nothing that the table
      // summarised as "+n more".
      return row.urls.length > 0 ? row.urls.join(" | ") : null;
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
  url_column: number | null;
};

async function getUpload(runId: string): Promise<UploadRow | null> {
  const rows = await query<UploadRow>(
    "select filename, columns, rows, keyword_column, url_column from run_uploads where run_id = $1",
    [runId],
  );
  return rows[0] ?? null;
}

export type ExportGrid = { header: string[]; body: AsyncIterable<Cell[][]> };

/**
 * Builds the export as a header plus batches of body rows. When the run came
 * from an uploaded sheet AND the mode is intact, the user's original columns
 * lead and the metrics are appended, so the file they get back is their file
 * plus data.
 */
export async function buildExportGrid(
  runId: string,
  columns: ExportColumnKey[],
  mode: DedupMode,
  /**
   * Row keys to export (see row-key.ts). Omit to export every row. Rows keep
   * their natural order — the selection filters, it never reorders — so an
   * intact-mode export still matches the user's original sheet.
   */
  selection?: string[],
): Promise<ExportGrid> {
  const selected = columns.length > 0 ? columns : DEFAULT_EXPORT_COLUMNS;
  const metricColumns = EXPORT_COLUMNS.filter((c) => selected.includes(c.key));
  const metricCells = (row: ResultRow) => metricColumns.map((c) => valueFor(row, c.key));

  const batches = iterateResultRows(runId, mode, selection && selection.length > 0 ? selection : undefined);
  // The header depends on whether there are any rows (as it always did), so
  // read the first batch before deciding.
  const first = await batches.next();
  const firstBatch = first.done ? [] : first.value;

  const upload = mode === "deduped" ? null : await getUpload(runId);

  if (upload && firstBatch.length > 0 && firstBatch[0].row.position !== null) {
    /*
     * Intact + uploaded: the user's original columns lead, metrics follow.
     *
     * Rows are looked up by `source_row`, NOT by `position`. `position` counts
     * only non-empty keywords, so on a sheet with a blank keyword cell it drifts
     * out of step with the sheet and attaches the wrong original row — and,
     * once URLs are involved, the wrong destination page — to everything after
     * the gap.
     */
    const width = upload.columns.length;
    const toCells = (batch: typeof firstBatch): Cell[][] =>
      batch.map(({ row, sourceRow: mapped }) => {
        // Runs created before source_row existed have null; fall back to
        // position so their exports keep working exactly as they did, rather
        // than coming back with every uploaded column blank.
        const sourceRow = mapped ?? row.position;
        const original = sourceRow !== null && sourceRow !== undefined ? (upload.rows[sourceRow] ?? []) : [];
        const padded = [...original, ...Array(Math.max(0, width - original.length)).fill("")];
        return [...padded, ...metricCells(row)];
      });

    return {
      header: [...upload.columns, ...metricColumns.map((c) => c.label)],
      body: (async function* () {
        yield toCells(firstBatch);
        for await (const batch of batches) yield toCells(batch);
      })(),
    };
  }

  return {
    header: metricColumns.map((c) => c.label),
    body: (async function* () {
      if (firstBatch.length > 0) yield firstBatch.map(({ row }) => metricCells(row));
      for await (const batch of batches) yield batch.map(({ row }) => metricCells(row));
    })(),
  };
}

const CSV_NEWLINE = "\r\n";

function csvRows(rows: Cell[][]): string {
  return Papa.unparse(rows.map((r) => r.map((c) => (c === null ? "" : c))));
}

/**
 * Streams the grid as CSV. Papa serialises each row independently and joins
 * rows with CRLF, so serialising batch by batch and joining batches with CRLF
 * yields exactly the bytes of one Papa.unparse over the whole grid.
 */
export function gridToCsvStream(grid: ExportGrid): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = grid.body[Symbol.asyncIterator]();
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(csvRows([grid.header])));
          return;
        }
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        if (next.value.length > 0) controller.enqueue(encoder.encode(CSV_NEWLINE + csvRows(next.value)));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

export async function gridToXlsx(grid: ExportGrid): Promise<Buffer> {
  // write-excel-file needs the whole sheet up front; cells are built batch by
  // batch so the source rows can be released as they are converted.
  const sheet: { value: string | number; fontWeight?: "bold" }[][] = [
    grid.header.map((h) => ({ value: h, fontWeight: "bold" as const })),
  ];
  for await (const batch of grid.body) {
    for (const r of batch) sheet.push(r.map((c) => ({ value: c === null ? "" : c })));
  }
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
