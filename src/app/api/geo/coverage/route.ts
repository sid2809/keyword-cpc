import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { geoCoverage, isGeoNetwork, normalizeGeoKeywords } from "@/lib/geo-breakdown";

/**
 * POST /api/geo/coverage  { keywords: string[], network }
 * → { counts: { [keyword]: countries scanned this month } }
 * Used to mark table rows that already have a breakdown. POST because a page
 * of 500 keywords doesn't fit in a URL.
 */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!isGeoNetwork(b.network)) return NextResponse.json({ error: "Unknown network." }, { status: 400 });

  const keywords = normalizeGeoKeywords(b.keywords).slice(0, 1000);
  return NextResponse.json({ counts: await geoCoverage(keywords, b.network) }, { headers: { "Cache-Control": "no-store" } });
}
