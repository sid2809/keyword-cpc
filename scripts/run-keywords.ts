/**
 * CLI trigger for the Phase 2 runner, so it can be exercised without any UI.
 *
 *   npm run run:keywords -- --keywords "gardening tools,lawn mower" --tag garden
 *   npm run run:keywords -- --file keywords.txt --name "Q3 audit" --months 3
 *   npm run run:keywords -- --resume <run-id>
 *   npm run run:keywords -- --show <run-id> [--mode deduped]
 *   npm run run:keywords -- --list
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

async function lib() {
  // Imported lazily so `--help` works without a database connection.
  const [runner, results, keywords, settings, db] = await Promise.all([
    import("../src/lib/runner"),
    import("../src/lib/results"),
    import("../src/lib/keywords"),
    import("../src/lib/run-settings"),
    import("../src/lib/db"),
  ]);
  return { ...runner, ...results, ...keywords, ...settings, ...db };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const USAGE = `
Keyword CPC runner

  --keywords "a,b,c"     comma/newline separated keywords
  --file <path>          read keywords from a file instead
  --name <text>          run name
  --tag <text>           niche/site label
  --months <3|6|12>      monthly volume series length (default 12)
  --mode <intact|deduped>  how results are shown (default intact)

  --resume <run-id>      resume a failed or interrupted run
  --show <run-id>        print a finished run's results
  --list                 list recent runs
`.trim();

async function main() {
  if (has("help") || process.argv.length <= 2) {
    console.log(USAGE);
    return;
  }

  const {
    createRun, executeRun, getRun, resumeInterruptedRuns,
    getResults, getRunSummary, formatMicros,
    parseKeywordText, getPool, query,
  } = await lib();

  // --- list ---------------------------------------------------------------
  if (has("list")) {
    const rows = await query<{
      id: string; name: string | null; tag: string | null; status: string;
      total_keywords: number; processed: number; created_at: Date;
    }>("select id, name, tag, status, total_keywords, processed, created_at from runs order by created_at desc limit 20");

    if (rows.length === 0) console.log("No runs yet.");
    for (const r of rows) {
      console.log(
        `${r.id}  ${String(r.status).padEnd(8)} ${String(r.processed).padStart(6)}/${String(r.total_keywords).padEnd(6)} ` +
          `${(r.name ?? "—").padEnd(24)} ${(r.tag ?? "—").padEnd(16)} ${r.created_at.toISOString().slice(0, 16)}`,
      );
    }
    await getPool().end();
    return;
  }

  // --- show ---------------------------------------------------------------
  const showId = arg("show");
  if (showId) {
    const run = await getRun(showId);
    if (!run) {
      console.error(`Run ${showId} not found`);
      process.exit(1);
    }
    const mode = arg("mode") as "intact" | "deduped" | undefined;
    const rows = await getResults(showId, mode);
    const summary = await getRunSummary(showId);

    console.log(`Run ${run.id}  ${run.status}  ${run.name ?? "(unnamed)"}${run.tag ? `  [${run.tag}]` : ""}`);
    console.log(
      `  ${summary.total} keywords, ${summary.noData} no-data · ` +
        `wtd top-of-page ${formatMicros(summary.weightedAvgHighTopMicros)} ` +
        `(floor ${formatMicros(summary.weightedAvgLowTopMicros)}) · ` +
        `median ${formatMicros(summary.medianHighTopMicros)} · ` +
        `avg CPC ${formatMicros(summary.weightedAvgCpcMicros)} · ` +
        `total volume ${summary.totalMonthlyVolume.toLocaleString("en-IN")}`,
    );
    console.log();
    console.log(
      `  ${"submitted".padEnd(26)} ${"canonical".padEnd(22)} ${"low top".padStart(10)} ${"high top".padStart(11)} ${"avg CPC".padStart(11)} ${"volume".padStart(9)}  months`,
    );
    for (const r of rows) {
      console.log(
        `  ${r.submitted.slice(0, 25).padEnd(26)} ${(r.canonical ?? "—").slice(0, 21).padEnd(22)} ` +
          `${formatMicros(r.lowTopMicros).padStart(10)} ${formatMicros(r.highTopMicros).padStart(11)} ` +
          `${formatMicros(r.averageCpcMicros).padStart(11)} ` +
          `${(r.avgMonthlySearches ?? 0).toLocaleString("en-IN").padStart(9)}  ` +
          `${r.monthlyVolumes?.length ?? 0}${r.noData ? "  (no data)" : ""}`,
      );
    }
    await getPool().end();
    return;
  }

  // --- resume -------------------------------------------------------------
  const resumeId = arg("resume");
  if (resumeId) {
    if (resumeId === "all") {
      const ids = await resumeInterruptedRuns(reportProgress);
      console.log(ids.length ? `Resumed ${ids.length} run(s).` : "Nothing to resume.");
    } else {
      const before = await getRun(resumeId);
      if (!before) {
        console.error(`Run ${resumeId} not found`);
        process.exit(1);
      }
      console.log(`Resuming ${resumeId} from chunk ${before.chunk_cursor}…`);
      const after = await executeRun(resumeId, reportProgress);
      console.log(`→ ${after.status}  ${after.processed}/${after.total_keywords}`);
    }
    await getPool().end();
    return;
  }

  // --- create + execute ---------------------------------------------------
  const file = arg("file");
  const inline = arg("keywords");
  const text = file ? readFileSync(file, "utf8") : inline;
  if (!text) {
    console.error("Provide --keywords or --file (or --help).");
    process.exit(1);
  }

  const parsed = parseKeywordText(text);
  if (parsed.length === 0) {
    console.error("No usable keywords found in the input.");
    process.exit(1);
  }

  const monthsRaw = arg("months");
  const months = monthsRaw ? (Number(monthsRaw) as 3 | 6 | 12) : 12;
  if (![3, 6, 12].includes(months)) {
    console.error("--months must be 3, 6 or 12");
    process.exit(1);
  }
  const mode = (arg("mode") as "intact" | "deduped" | undefined) ?? "intact";

  const runId = await createRun({
    keywords: parsed,
    source: file ? "csv" : "paste",
    name: arg("name") ?? null,
    tag: arg("tag") ?? null,
    settings: { monthsBack: months, dedupMode: mode },
  });

  const unique = new Set(parsed.map((p) => p.normalized)).size;
  console.log(`Created run ${runId}`);
  console.log(`  ${parsed.length} submitted rows, ${unique} unique keywords`);

  const started = Date.now();
  const run = await executeRun(runId, reportProgress);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n→ ${run.status} in ${elapsed}s`);
  const summary = await getRunSummary(runId);
  console.log(
    `  ${summary.total} keywords, ${summary.noData} no-data · ` +
      `wtd top-of-page ${formatMicros(summary.weightedAvgHighTopMicros)} · ` +
      `median ${formatMicros(summary.medianHighTopMicros)} · avg CPC ${formatMicros(summary.weightedAvgCpcMicros)}`,
  );
  console.log(`\n  npm run run:keywords -- --show ${runId}`);

  await getPool().end();
}

function reportProgress(e: {
  chunkIndex: number; totalChunks: number; processed: number; total: number; fromCache: number; fromApi: number;
}) {
  console.log(
    `  chunk ${e.chunkIndex + 1}/${e.totalChunks} · ${e.processed}/${e.total} keywords · ` +
      `${e.fromCache} cached, ${e.fromApi} fetched`,
  );
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
