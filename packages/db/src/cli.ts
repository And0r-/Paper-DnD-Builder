/**
 * Database command line.
 *
 *   node packages/db/src/cli.ts migrate
 *
 * Runs on Node's built-in TypeScript support; no build step needed.
 */
import { createSql, readDatabaseUrl, sqlExecutor } from "./client.ts";
import { loadMigrations, migrate } from "./migrate.ts";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

async function main(command: string | undefined): Promise<void> {
  if (command !== "migrate") {
    console.error("Usage: cli.ts migrate");
    process.exitCode = 2;
    return;
  }
  // Pool size 1: each migration's BEGIN/COMMIT must run on the same session.
  const sql = createSql(readDatabaseUrl(), { max: 1 });
  try {
    const result = await migrate(sqlExecutor(sql), await loadMigrations(MIGRATIONS_DIR));
    if (result.applied.length === 0) {
      console.log("Database is up to date.");
    } else {
      console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
    }
  } finally {
    await sql.end();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
