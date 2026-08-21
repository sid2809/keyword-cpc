import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";
import { envHealth } from "@/lib/env";
import { getSession } from "@/lib/session";

/** Authenticated health probe. Reports presence of env vars, never values. */
export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await pingDb();
  const env = envHealth();

  return NextResponse.json({
    ok: db.ok && env.every((e) => e.present),
    db,
    env: Object.fromEntries(env.map((e) => [e.key, e.present])),
  });
}
