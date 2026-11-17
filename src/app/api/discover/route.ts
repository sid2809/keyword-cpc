import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createDiscovery, DiscoverError, parseIdeaLimit, parseSeeds } from "@/lib/discover";
import { executeRun } from "@/lib/runner";
import type { RunSettings } from "@/lib/types";

const MAX_LABEL_CHARS = 200;

function clamp(v: unknown): string | null {
  const s = (typeof v === "string" ? v : "").trim();
  return s === "" ? null : s.slice(0, MAX_LABEL_CHARS);
}

/**
 * Starts a discovery: new keywords from seeds.
 *
 *   POST /api/discover
 *   { seeds: [{ kind: "keyword" | "url" | "keyword_url" | "site", keyword?, target? }],
 *     settings?, name?, tag?, limit? }
 *
 * Returns the run id; the client follows it like any run
 * (/api/runs/:id/progress, /api/runs/:id/seeds).
 */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;

  let runId: string;
  let seedCount: number;
  try {
    const seeds = parseSeeds(body.seeds);
    const limit = parseIdeaLimit(body.limit);
    seedCount = seeds.length;
    runId = await createDiscovery({
      seeds,
      limit,
      settings:
        typeof body.settings === "object" && body.settings !== null && !Array.isArray(body.settings)
          ? (body.settings as Partial<RunSettings>)
          : undefined,
      name: clamp(body.name),
      tag: clamp(body.tag),
    });
  } catch (err) {
    if (err instanceof DiscoverError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  // Fire and forget, like a normal run; executeRun routes it to the discovery job.
  void executeRun(runId).catch((err) => {
    console.error(`[discover] run ${runId} failed:`, err instanceof Error ? err.message : err);
  });

  return NextResponse.json({ id: runId, seeds: seedCount }, { status: 201 });
}
