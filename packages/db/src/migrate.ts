import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { SqlExecutor } from "./executor.ts";

export interface Migration {
  /** File name without extension, e.g. `0001_init`. Sort order is apply order. */
  id: string;
  sql: string;
  /** SHA-256 of the file content; detects edits to already applied migrations. */
  checksum: string;
}

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Arbitrary but fixed key so concurrent starts (e.g. two containers) apply migrations once. */
const MIGRATION_LOCK_KEY = 4_207_310_001;

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function loadMigrations(dir: URL | string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const seenNumbers = new Set<string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = MIGRATION_FILE.exec(file);
    if (!match?.[1]) {
      throw new Error(`Invalid migration file name "${file}". Expected NNNN_snake_case.sql.`);
    }
    if (seenNumbers.has(match[1])) {
      throw new Error(`Duplicate migration number ${match[1]}.`);
    }
    seenNumbers.add(match[1]);
    const sql = await readFile(new URL(file, toDirUrl(dir)), "utf8");
    migrations.push({ id: file.slice(0, -".sql".length), sql, checksum: checksumOf(sql) });
  }
  return migrations;
}

function toDirUrl(dir: URL | string): URL {
  const url = typeof dir === "string" ? new URL(`file://${dir}`) : dir;
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Applies pending migrations in order, each in its own transaction.
 *
 * Refuses to run when the database knows a migration the code does not, or
 * when an applied migration's file was edited afterwards: both mean the code
 * and the database disagree and silently continuing could corrupt data.
 *
 * The executor must run all statements on one session (pool size 1).
 */
export async function migrate(db: SqlExecutor, migrations: readonly Migration[]): Promise<MigrateResult> {
  await db.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedRows = await db.query<{ id: string; checksum: string }>(
      "SELECT id, checksum FROM schema_migrations ORDER BY id",
    );
    const known = new Map(migrations.map((m) => [m.id, m]));
    for (const row of appliedRows) {
      const migration = known.get(row.id);
      if (!migration) {
        throw new Error(`Database has migration "${row.id}" that this code does not know.`);
      }
      if (migration.checksum !== row.checksum) {
        throw new Error(
          `Migration "${row.id}" was changed after it was applied. Add a new migration instead.`,
        );
      }
    }

    const appliedIds = new Set(appliedRows.map((row) => row.id));
    const applied: string[] = [];
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue;
      await db.exec("BEGIN");
      try {
        await db.exec(migration.sql);
        await db.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [
          migration.id,
          migration.checksum,
        ]);
        await db.exec("COMMIT");
      } catch (error) {
        await db.exec("ROLLBACK");
        throw new Error(`Migration "${migration.id}" failed.`, { cause: error });
      }
      applied.push(migration.id);
    }
    return { applied, alreadyApplied: [...appliedIds] };
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
}
