/**
 * Applies every .sql file in db/migrations that has not run yet, in filename
 * order, each inside a transaction. Run with `npm run db:migrate`.
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Fill it in .env (see .env.example).");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query<{ filename: string }>("select filename from schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`  apply ${file}`);
      ran += 1;
    } catch (err) {
      await client.query("rollback");
      console.error(`  FAIL  ${file}`);
      console.error(err instanceof Error ? err.message : err);
      await client.end();
      process.exit(1);
    }
  }

  console.log(ran === 0 ? "Database already up to date." : `Applied ${ran} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
