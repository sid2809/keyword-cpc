import "server-only";
import Papa from "papaparse";
// `readSheet` returns the first sheet's row grid. The default export returns an
// array of { sheet, data } wrappers instead, which is not what we want here.
import { readSheet } from "read-excel-file/node";

/**
 * CSV / XLSX parsing for the upload tab (PLAN.md §6): drag-drop a file, pick
 * which column holds the keywords, preview the first ten rows.
 *
 * SheetJS is deliberately not used — its npm package has been frozen at 0.18.5
 * since 2022 with open advisories; distribution moved to the vendor's own CDN.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const PREVIEW_ROWS = 10;

export type ParsedSheet = {
  columns: string[];
  /** Data rows only — the header row, if any, is stripped. */
  rows: string[][];
  hasHeader: boolean;
  totalRows: number;
};

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * A first row is treated as a header when every cell is non-empty text and at
 * least one cell is not purely numeric — otherwise a sheet that is just a bare
 * list of keywords would lose its first keyword to the header.
 */
function looksLikeHeader(row: string[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  if (row.some((c) => c === "")) return false;
  return row.some((c) => c !== "" && Number.isNaN(Number(c)));
}

function labelColumns(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Column ${String.fromCharCode(65 + (i % 26))}`);
}

function normaliseGrid(grid: unknown[][]): ParsedSheet {
  const rows = grid.map((r) => r.map(cellToString)).filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) return { columns: [], rows: [], hasHeader: false, totalRows: 0 };

  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));

  const hasHeader = looksLikeHeader(padded[0]) && padded.length > 1;
  const columns = hasHeader ? padded[0] : labelColumns(width);
  const dataRows = hasHeader ? padded.slice(1) : padded;

  return { columns, rows: dataRows, hasHeader, totalRows: dataRows.length };
}

export async function parseCsv(buffer: Buffer): Promise<ParsedSheet> {
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    // Read as arrays, not objects — the header row is decided by looksLikeHeader.
    header: false,
  });
  if (parsed.errors.length > 0) {
    // Papa reports per-row issues but still yields data; only fail if nothing parsed.
    const fatal = parsed.data.length === 0;
    if (fatal) throw new Error(`Could not read the CSV: ${parsed.errors[0].message}`);
  }
  return normaliseGrid(parsed.data);
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  // Only the first sheet is read — the plan's upload flow asks which *column*
  // holds the keywords, not which sheet.
  const grid = await readSheet(buffer);
  return normaliseGrid(grid as unknown[][]);
}

export async function parseSpreadsheet(filename: string, buffer: Buffer): Promise<ParsedSheet> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return parseXlsx(buffer);
  throw new Error("Upload a .csv or .xlsx file.");
}

/**
 * Guesses which column holds the keywords: prefer a header that says so,
 * otherwise the column with the most distinct multi-word text values.
 */
export function guessKeywordColumn(sheet: ParsedSheet): number {
  const named = sheet.columns.findIndex((c) => /keyword|query|term|search/i.test(c));
  if (named >= 0) return named;

  let best = 0;
  let bestScore = -1;
  for (let col = 0; col < sheet.columns.length; col++) {
    const values = sheet.rows.slice(0, 200).map((r) => r[col] ?? "");
    const nonEmpty = values.filter((v) => v !== "");
    if (nonEmpty.length === 0) continue;
    const distinct = new Set(nonEmpty).size;
    const texty = nonEmpty.filter((v) => Number.isNaN(Number(v))).length;
    const score = texty * 2 + distinct;
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  return best;
}

export function columnValues(sheet: ParsedSheet, columnIndex: number): string[] {
  return sheet.rows.map((r) => r[columnIndex] ?? "");
}
