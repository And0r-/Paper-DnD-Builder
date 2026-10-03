/**
 * Minimal SQL surface the migration runner needs. Kept tiny so it can be
 * backed by the production driver and by an in-process database in tests.
 */
export interface SqlExecutor {
  /** Runs one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** Runs a single parameterised statement and returns its rows. */
  query<Row extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}
