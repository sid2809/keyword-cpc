import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { env } from "./env";

/**
 * Single shared pool. Next's dev server re-evaluates modules on hot reload, so
 * the pool is stashed on globalThis to avoid leaking a new pool per reload.
 */
const globalForDb = globalThis as unknown as { __kcpcPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.__kcpcPool) {
    globalForDb.__kcpcPool = new Pool({
      connectionString: env.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForDb.__kcpcPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Cheap round-trip used by the health check. */
export async function pingDb(): Promise<{ ok: true; serverVersion: string } | { ok: false; error: string }> {
  try {
    const rows = await query<{ version: string }>("select version() as version");
    return { ok: true, serverVersion: rows[0]?.version ?? "unknown" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
