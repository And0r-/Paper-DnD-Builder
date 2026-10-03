import postgres from "postgres";
import type { SqlExecutor } from "./executor.ts";

export type Sql = postgres.Sql;

export interface CreateSqlOptions {
  /** Maximum pool size. Use 1 when statements must share a session (e.g. BEGIN/COMMIT). */
  max?: number;
}

/** Reads the connection string from the environment. Never logs it: it contains credentials. */
export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  return url;
}

export function createSql(url: string, options: CreateSqlOptions = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    // Notices such as "relation already exists, skipping" are expected noise.
    onnotice: () => {},
  });
}

export function sqlExecutor(sql: Sql): SqlExecutor {
  return {
    async exec(text) {
      // Without parameters postgres.js uses the simple query protocol,
      // which allows several statements in one call.
      await sql.unsafe(text);
    },
    async query<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as Row[];
    },
  };
}
