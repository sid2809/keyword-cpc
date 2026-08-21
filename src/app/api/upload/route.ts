import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { guessKeywordColumn, parseSpreadsheet, PREVIEW_ROWS } from "@/lib/spreadsheet";

/**
 * Parses an uploaded CSV/XLSX and returns its columns plus a preview, so the
 * user can pick which column holds the keywords (PLAN.md §6).
 *
 * The full parsed grid comes back too — the New Search page holds it and posts
 * it with the run so the export can preserve the user's other columns.
 */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sheet = await parseSpreadsheet(file.name, buffer);

    if (sheet.columns.length === 0) {
      return NextResponse.json({ error: "That file appears to be empty." }, { status: 400 });
    }

    return NextResponse.json({
      filename: file.name,
      columns: sheet.columns,
      rows: sheet.rows,
      preview: sheet.rows.slice(0, PREVIEW_ROWS),
      totalRows: sheet.totalRows,
      hasHeader: sheet.hasHeader,
      suggestedColumn: guessKeywordColumn(sheet),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that file." },
      { status: 400 },
    );
  }
}
