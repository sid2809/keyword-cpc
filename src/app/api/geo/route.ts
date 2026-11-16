import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getGeoBreakdown,
  isGeoNetwork,
  MAX_GEO_KEYWORDS,
  normalizeGeoKeywords,
  startGeoJob,
} from "@/lib/geo-breakdown";

/**
 * Country breakdown for keywords.
 *
 *   GET  /api/geo?keyword=…&network=…   what is known for one keyword + job progress
 *   POST /api/geo  { keywords: string[], network, scope: "shortlist" | "all" }
 *        starts (or joins) a background job; returns its id.
 */
export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const [keyword] = normalizeGeoKeywords([sp.get("keyword")]);
  const network = sp.get("network");
  if (!keyword) return NextResponse.json({ error: "keyword is required." }, { status: 400 });
  if (!isGeoNetwork(network)) return NextResponse.json({ error: "Unknown network." }, { status: 400 });

  return NextResponse.json(await getGeoBreakdown(keyword, network), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const keywords = normalizeGeoKeywords(b.keywords);
  if (keywords.length === 0) return NextResponse.json({ error: "No keywords given." }, { status: 400 });
  if (keywords.length > MAX_GEO_KEYWORDS) {
    return NextResponse.json({ error: `At most ${MAX_GEO_KEYWORDS} keywords per breakdown.` }, { status: 400 });
  }
  if (!isGeoNetwork(b.network)) return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  if (b.scope !== "shortlist" && b.scope !== "all") {
    return NextResponse.json({ error: "scope must be shortlist or all." }, { status: 400 });
  }

  const job = await startGeoJob({ keywords, network: b.network, scope: b.scope });
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
