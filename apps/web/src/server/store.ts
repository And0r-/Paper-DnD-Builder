/**
 * All SQL of the app, on the small executor interface of @builder/db so
 * tests run the same statements against an in-process PostgreSQL.
 *
 * Every statement is a single statement: optimistic locking on drafts
 * needs no transaction, and deleting an account cascades in the database.
 * jsonb parameters are passed as objects: both drivers encode them, and a
 * pre-encoded string would be stored as a JSON string.
 */
import type { SqlExecutor } from "@builder/db";
import type { DraftDocument } from "@builder/core";

export type AccountRow = {
  id: string;
  email: string;
  password_hash: string;
  language: string;
  units: Record<string, string>;
  created_at: Date;
};

export type DraftRow = {
  id: string;
  account_id: string;
  package_id: string;
  package_version: string;
  version: number;
  document: DraftDocument;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export interface SessionAccount {
  session_id: string;
  refreshed_at: Date;
  account: AccountRow;
}

const ACCOUNT_COLUMNS = "id, email, password_hash, language, units, created_at";
const DRAFT_COLUMNS =
  "id, account_id, package_id, package_version, version, document, finished_at, created_at, updated_at";

export class Store {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  // ---------------------------------------------------------------- accounts

  async findAccountByEmail(email: string): Promise<AccountRow | undefined> {
    const rows = await this.db.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email = $1`, [
      email,
    ]);
    return rows[0];
  }

  /** Inserts an account; returns undefined if the address already has one (concurrent sign-up). */
  async createAccount(a: Omit<AccountRow, "units">): Promise<AccountRow | undefined> {
    const rows = await this.db.query<AccountRow>(
      `INSERT INTO accounts (id, email, password_hash, language, units, created_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${ACCOUNT_COLUMNS}`,
      [a.id, a.email, a.password_hash, a.language, a.created_at],
    );
    return rows[0];
  }

  async setPasswordHash(accountId: string, passwordHash: string): Promise<void> {
    await this.db.query("UPDATE accounts SET password_hash = $2 WHERE id = $1", [accountId, passwordHash]);
  }

  async updateSettings(
    accountId: string,
    language: string,
    units: Record<string, string>,
  ): Promise<AccountRow> {
    const rows = await this.db.query<AccountRow>(
      `UPDATE accounts SET language = $2, units = $3::jsonb WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [accountId, language, units],
    );
    return rows[0]!;
  }

  /** Removes the account and, by cascade, its sessions and drafts. */
  async deleteAccount(accountId: string): Promise<void> {
    await this.db.query("DELETE FROM accounts WHERE id = $1", [accountId]);
  }

  // ---------------------------------------------------------------- sessions

  async createSession(id: string, accountId: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db.query(
      "INSERT INTO sessions (id, account_id, expires_at, refreshed_at) VALUES ($1, $2, $3, $4)",
      [id, accountId, expiresAt, now],
    );
  }

  async findSession(id: string, now: Date): Promise<SessionAccount | undefined> {
    const rows = await this.db.query<AccountRow & { session_id: string; refreshed_at: Date }>(
      `SELECT s.id AS session_id, s.refreshed_at, a.id, a.email, a.password_hash, a.language, a.units, a.created_at
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.id = $1 AND s.expires_at > $2`,
      [id, now],
    );
    const row = rows[0];
    if (!row) return undefined;
    const { session_id, refreshed_at, ...account } = row;
    return { session_id, refreshed_at, account };
  }

  async refreshSession(id: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db.query("UPDATE sessions SET expires_at = $2, refreshed_at = $3 WHERE id = $1", [
      id,
      expiresAt,
      now,
    ]);
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  /** Ends every session of an account except `keep`. */
  async deleteOtherSessions(accountId: string, keep: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE account_id = $1 AND id <> $2", [accountId, keep]);
  }

  async deleteExpiredSessions(now: Date): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
  }

  // ------------------------------------------------------------------ drafts

  async createDraft(d: Omit<DraftRow, "finished_at" | "updated_at">): Promise<DraftRow> {
    const rows = await this.db.query<DraftRow>(
      `INSERT INTO drafts (id, account_id, package_id, package_version, version, document, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
       RETURNING ${DRAFT_COLUMNS}`,
      [d.id, d.account_id, d.package_id, d.package_version, d.version, d.document, d.created_at],
    );
    return rows[0]!;
  }

  async findDraft(id: string, accountId: string): Promise<DraftRow | undefined> {
    const rows = await this.db.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM drafts WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    return rows[0];
  }

  async listDrafts(accountId: string): Promise<DraftRow[]> {
    return this.db.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM drafts WHERE account_id = $1 ORDER BY updated_at DESC, id`,
      [accountId],
    );
  }

  /**
   * Stores a new state only if the draft is still at `expectedVersion`.
   * Returns undefined when someone else changed it first.
   */
  async updateDraft(
    id: string,
    accountId: string,
    expectedVersion: number,
    next: { document: DraftDocument; finishedAt: Date | null; packageVersion: string; now: Date },
  ): Promise<DraftRow | undefined> {
    const rows = await this.db.query<DraftRow>(
      `UPDATE drafts
       SET document = $4::jsonb, finished_at = $5, package_version = $6, updated_at = $7, version = version + 1
       WHERE id = $1 AND account_id = $2 AND version = $3
       RETURNING ${DRAFT_COLUMNS}`,
      [id, accountId, expectedVersion, next.document, next.finishedAt, next.packageVersion, next.now],
    );
    return rows[0];
  }

  async deleteDraft(id: string, accountId: string): Promise<boolean> {
    const rows = await this.db.query("DELETE FROM drafts WHERE id = $1 AND account_id = $2 RETURNING id", [
      id,
      accountId,
    ]);
    return rows.length > 0;
  }
}
