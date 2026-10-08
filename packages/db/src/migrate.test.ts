import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqlExecutor } from "./executor.ts";
import { checksumOf, loadMigrations, migrate, type Migration } from "./migrate.ts";

// In-process PostgreSQL, so migrations are tested against a real, empty database.
function pgliteExecutor(pg: PGlite): SqlExecutor {
  return {
    async exec(sql) {
      await pg.exec(sql);
    },
    async query<Row extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const result = await pg.query<Row>(sql, [...params]);
      return result.rows;
    },
  };
}

function migration(id: string, sql: string): Migration {
  return { id, sql, checksum: checksumOf(sql) };
}

describe("migrate", () => {
  let pg: PGlite;
  let db: SqlExecutor;

  beforeEach(async () => {
    pg = new PGlite();
    db = pgliteExecutor(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it("applies the repository's migrations to an empty database", async () => {
    const migrations = await loadMigrations(new URL("../migrations/", import.meta.url));
    expect(migrations.map((m) => m.id)).toContain("0001_init");

    const result = await migrate(db, migrations);

    expect(result.applied).toEqual(migrations.map((m) => m.id));
    const rows = await db.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(migrations.map((m) => m.id));
  });

  it("names the access keys made before names, by the day they were made", async () => {
    const migrations = await loadMigrations(new URL("../migrations/", import.meta.url));
    const at = migrations.findIndex((m) => m.id === "0008_access_key_names");
    await migrate(db, migrations.slice(0, at));
    await db.query(
      `INSERT INTO accounts (id, email, password_hash, language, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', 'a@example.org', 'x', 'de', now())`,
    );
    await db.query(
      `INSERT INTO access_keys (id, account_id, key_hash, hint, created_at)
       VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
               'h', 'cbk_abcdef', '2026-10-04T23:30:00Z')`,
    );

    await migrate(db, migrations);

    const rows = await db.query("SELECT name, expires_at, kind FROM access_keys");
    expect(rows).toEqual([{ name: "2026-10-04", expires_at: null, kind: "personal" }]);
  });

  it("names the accounts made before by their address, keeps their old password, frees the address", async () => {
    const migrations = await loadMigrations(new URL("../migrations/", import.meta.url));
    const at = migrations.findIndex((m) => m.id === "0010_passwords");
    await migrate(db, migrations.slice(0, at));
    await db.query(
      `INSERT INTO accounts (id, email, password_hash, language, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', 'mira.fenn@example.org', 'x', 'de', now())`,
    );

    await migrate(db, migrations);

    const rows = await db.query("SELECT name, email, password_hash FROM accounts");
    expect(rows).toEqual([{ name: "mira.fenn", email: "mira.fenn@example.org", password_hash: "x" }]);
    // The address is no key anymore; an account may have none.
    await db.query(
      `INSERT INTO accounts (id, name, email, language, created_at) VALUES
       ('00000000-0000-4000-8000-000000000002', 'B', 'mira.fenn@example.org', 'de', now()),
       ('00000000-0000-4000-8000-000000000003', 'C', NULL, 'de', now())`,
    );
    await expect(
      db.query(
        `INSERT INTO accounts (id, name, language, created_at)
         VALUES ('00000000-0000-4000-8000-000000000004', '', 'de', now())`,
      ),
    ).rejects.toThrow();
  });

  it("is idempotent", async () => {
    const migrations = [migration("0001_a", "CREATE TABLE a (x int)")];
    await migrate(db, migrations);

    const second = await migrate(db, migrations);

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(["0001_a"]);
  });

  it("applies only new migrations in order", async () => {
    await migrate(db, [migration("0001_a", "CREATE TABLE a (x int)")]);

    const result = await migrate(db, [
      migration("0001_a", "CREATE TABLE a (x int)"),
      migration("0002_b", "CREATE TABLE b (y int)"),
    ]);

    expect(result.applied).toEqual(["0002_b"]);
  });

  it("rolls back a failing migration completely", async () => {
    const failing = migration("0001_bad", "CREATE TABLE half (x int); SELECT * FROM missing_table;");

    await expect(migrate(db, [failing])).rejects.toThrow('Migration "0001_bad" failed.');

    const tables = await db.query("SELECT 1 FROM pg_tables WHERE tablename = 'half'");
    expect(tables).toHaveLength(0);
    const recorded = await db.query("SELECT 1 FROM schema_migrations");
    expect(recorded).toHaveLength(0);
  });

  it("refuses to run when an applied migration was edited", async () => {
    await migrate(db, [migration("0001_a", "CREATE TABLE a (x int)")]);

    await expect(migrate(db, [migration("0001_a", "CREATE TABLE a (x bigint)")])).rejects.toThrow(
      "was changed after it was applied",
    );
  });

  it("refuses to run when the database is ahead of the code", async () => {
    await migrate(db, [migration("0001_a", "CREATE TABLE a (x int)")]);

    await expect(migrate(db, [])).rejects.toThrow("that this code does not know");
  });
});

describe("loadMigrations", () => {
  it("rejects badly named files", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    await writeFile(join(dir, "init.sql"), "SELECT 1");

    await expect(loadMigrations(dir)).rejects.toThrow('Invalid migration file name "init.sql"');
  });
});
