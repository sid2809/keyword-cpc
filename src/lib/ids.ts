/**
 * Run id validation.
 *
 * Postgres raises `invalid input syntax for type uuid` on a malformed id, which
 * surfaces as a 500 rather than a 404. Every entry point that accepts an id
 * from a URL or a request body must check it first.
 *
 * Kept in its own module with no imports so both client and server code, and
 * modules at any layer, can use it without creating a cycle.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
