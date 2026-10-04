/**
 * Stand-ins for PostgreSQL and SMTP, for trying the builder locally and
 * for the browser tests. Never for a real server:
 *
 * - `DATABASE_URL=pglite:memory` runs an in-process PostgreSQL (PGlite)
 *   that forgets everything when the server stops. Migrations run at start.
 * - `MAIL_OUTBOX_DIR=/some/dir` writes every mail as a text file into that
 *   folder instead of sending it. The folder then holds passwords.
 *
 * PGlite is a dev dependency, so the production image cannot use it even
 * by mistake. Both print a warning at start.
 */
import { loadMigrations, migrate, type SqlExecutor } from "@builder/db";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mailer } from "./mail.ts";

export const PGLITE_MEMORY_URL = "pglite:memory";

/** The small executor interface on top of a PGlite instance. */
export function pgliteExecutor(pg: {
  exec(sql: string): Promise<unknown>;
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}): SqlExecutor {
  return {
    async exec(sql) {
      await pg.exec(sql);
    },
    async query<Row extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      return (await pg.query<Row>(sql, [...params])).rows;
    },
  };
}

/**
 * The repository's migrations folder. Found from the working directory,
 * because a bundled server module no longer knows where its source was:
 * the repository root (tests) or apps/web (next dev / next start).
 */
export function migrationsDir(): string {
  const candidates = [
    join(process.cwd(), "packages/db/migrations"),
    join(process.cwd(), "../../packages/db/migrations"),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found)
    throw new Error("Migrations folder packages/db/migrations not found from the working directory.");
  return found;
}

/** A migrated, empty in-memory database. */
export async function memoryDatabase(): Promise<SqlExecutor> {
  console.warn("Database: in-memory PGlite. Everything is lost when the server stops. Not for real use.");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = pgliteExecutor(new PGlite());
  await migrate(db, await loadMigrations(migrationsDir()));
  return db;
}

/** Writes mails into a folder instead of sending them. */
export function outboxMailer(dir: string): Mailer {
  console.warn(`Mail: writing mails to ${dir} instead of sending them. Not for real use.`);
  let n = 0;
  return {
    async send(mail) {
      await mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${String(++n).padStart(4, "0")}-${mail.to.replace(/[^a-z0-9@.-]/gi, "_")}.txt`;
      await writeFile(join(dir, name), `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    },
  };
}
