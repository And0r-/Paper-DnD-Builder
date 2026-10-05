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

/** An access key as its owner sees it; the hash never leaves the store. */
export type AccessKeyRow = {
  id: string;
  hint: string;
  created_at: Date;
};

/** A draft with whose it is and why the viewer may see it. */
export type ReachableDraftRow = DraftRow & {
  owner_email: string;
  /** "owner": the viewer's own; "gameMaster": a character of a player in a campaign the viewer leads. */
  access: "owner" | "gameMaster";
};

export type CampaignRow = {
  id: string;
  name: string;
  created_at: Date;
  game_master_email: string;
  /** Whether the viewer leads it; else the viewer plays in it. */
  leading: boolean;
  player_count: number;
};

export type PlayerRow = {
  /** The player's account id. */
  id: string;
  email: string;
  added_at: Date;
};

const ACCESS_KEY_COLUMNS = "id, hint, created_at";
const ACCOUNT_COLUMNS = "id, email, password_hash, language, units, created_at";
const DRAFT_COLUMNS =
  "id, account_id, package_id, package_version, version, document, finished_at, created_at, updated_at";
const DRAFT_COLUMNS_D = DRAFT_COLUMNS.split(", ")
  .map((c) => `d.${c}`)
  .join(", ");

/**
 * The one rule of who may reach whose characters: the owner, and the game
 * master of a campaign the owner plays in. `$viewer` is the viewer's
 * account id, `d` the drafts row.
 */
const reachable = (viewer: string) => `(d.account_id = ${viewer} OR EXISTS (
  SELECT 1 FROM campaign_players p JOIN campaigns c ON c.id = p.campaign_id
  WHERE p.account_id = d.account_id AND c.account_id = ${viewer}))`;

/** A campaign as the viewer `$1` sees it; `c` the campaigns row. */
const CAMPAIGN_SELECT = `SELECT c.id, c.name, c.created_at, gm.email AS game_master_email,
  c.account_id = $1 AS leading,
  (SELECT count(*) FROM campaign_players n WHERE n.campaign_id = c.id)::int AS player_count
  FROM campaigns c JOIN accounts gm ON gm.id = c.account_id`;
const VISIBLE_CAMPAIGN = `(c.account_id = $1 OR EXISTS (
  SELECT 1 FROM campaign_players p WHERE p.campaign_id = c.id AND p.account_id = $1))`;

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

  /**
   * Removes the account and, by cascade, its sessions, access keys and drafts,
   * the campaigns it leads (with their player lists; the players' characters
   * stay with the players) and its places in other campaigns.
   */
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

  // ------------------------------------------------------------- access keys

  /** Inserts a key unless the account already has `max`; returns undefined then. */
  async createAccessKey(k: AccessKeyRow & { account_id: string; key_hash: string }, max: number) {
    const rows = await this.db.query<AccessKeyRow>(
      `INSERT INTO access_keys (id, account_id, key_hash, hint, created_at)
       SELECT $1, $2, $3, $4, $5
       WHERE (SELECT count(*) FROM access_keys WHERE account_id = $2) < $6
       RETURNING ${ACCESS_KEY_COLUMNS}`,
      [k.id, k.account_id, k.key_hash, k.hint, k.created_at, max],
    );
    return rows[0];
  }

  async listAccessKeys(accountId: string): Promise<AccessKeyRow[]> {
    return this.db.query<AccessKeyRow>(
      `SELECT ${ACCESS_KEY_COLUMNS} FROM access_keys WHERE account_id = $1 ORDER BY created_at, id`,
      [accountId],
    );
  }

  /** The account a key belongs to. */
  async findAccountByKey(keyHash: string): Promise<{ key_id: string; account: AccountRow } | undefined> {
    const rows = await this.db.query<AccountRow & { key_id: string }>(
      `SELECT k.id AS key_id, a.id, a.email, a.password_hash, a.language, a.units, a.created_at
       FROM access_keys k JOIN accounts a ON a.id = k.account_id
       WHERE k.key_hash = $1`,
      [keyHash],
    );
    const row = rows[0];
    if (!row) return undefined;
    const { key_id, ...account } = row;
    return { key_id, account };
  }

  async deleteAccessKey(id: string, accountId: string): Promise<boolean> {
    const rows = await this.db.query(
      "DELETE FROM access_keys WHERE id = $1 AND account_id = $2 RETURNING id",
      [id, accountId],
    );
    return rows.length > 0;
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

  /** A draft the viewer may reach (see {@link reachable}); undefined for anyone else's. */
  async findReachableDraft(id: string, viewerId: string): Promise<ReachableDraftRow | undefined> {
    const rows = await this.db.query<ReachableDraftRow>(
      `SELECT ${DRAFT_COLUMNS_D}, o.email AS owner_email,
         CASE WHEN d.account_id = $2 THEN 'owner' ELSE 'gameMaster' END AS access
       FROM drafts d JOIN accounts o ON o.id = d.account_id
       WHERE d.id = $1 AND ${reachable("$2")}`,
      [id, viewerId],
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

  // --------------------------------------------------------------- campaigns

  /** Inserts a campaign unless the account already leads `max`; returns false then. */
  async createCampaign(
    c: { id: string; account_id: string; name: string; created_at: Date },
    max: number,
  ): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO campaigns (id, account_id, name, created_at)
       SELECT $1, $2, $3, $4
       WHERE (SELECT count(*) FROM campaigns WHERE account_id = $2) < $5
       RETURNING id`,
      [c.id, c.account_id, c.name, c.created_at, max],
    );
    return rows.length > 0;
  }

  /** The campaigns an account leads or plays in. */
  async listCampaigns(viewerId: string): Promise<CampaignRow[]> {
    return this.db.query<CampaignRow>(
      `${CAMPAIGN_SELECT} WHERE ${VISIBLE_CAMPAIGN} ORDER BY c.created_at, c.id`,
      [viewerId],
    );
  }

  /** A campaign the viewer leads or plays in; undefined for any other. */
  async findCampaign(id: string, viewerId: string): Promise<CampaignRow | undefined> {
    const rows = await this.db.query<CampaignRow>(
      `${CAMPAIGN_SELECT} WHERE c.id = $2 AND ${VISIBLE_CAMPAIGN}`,
      [viewerId, id],
    );
    return rows[0];
  }

  async renameCampaign(id: string, gameMasterId: string, name: string): Promise<void> {
    await this.db.query("UPDATE campaigns SET name = $3 WHERE id = $1 AND account_id = $2", [
      id,
      gameMasterId,
      name,
    ]);
  }

  /** Removes the campaign and its player list; the players' characters stay. */
  async deleteCampaign(id: string, gameMasterId: string): Promise<void> {
    await this.db.query("DELETE FROM campaigns WHERE id = $1 AND account_id = $2", [id, gameMasterId]);
  }

  async listPlayers(campaignId: string): Promise<PlayerRow[]> {
    return this.db.query<PlayerRow>(
      `SELECT a.id, a.email, p.added_at
       FROM campaign_players p JOIN accounts a ON a.id = p.account_id
       WHERE p.campaign_id = $1 ORDER BY p.added_at, a.email`,
      [campaignId],
    );
  }

  async findPlayer(campaignId: string, accountId: string): Promise<PlayerRow | undefined> {
    const rows = await this.db.query<PlayerRow>(
      `SELECT a.id, a.email, p.added_at
       FROM campaign_players p JOIN accounts a ON a.id = p.account_id
       WHERE p.campaign_id = $1 AND p.account_id = $2`,
      [campaignId, accountId],
    );
    return rows[0];
  }

  /**
   * Adds a player unless the campaign already has `max`. Adding someone who
   * is already a player changes nothing. Returns false only when full.
   */
  async addPlayer(campaignId: string, accountId: string, now: Date, max: number): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO campaign_players (campaign_id, account_id, added_at)
       SELECT $1, $2, $3
       WHERE (SELECT count(*) FROM campaign_players WHERE campaign_id = $1) < $4
       ON CONFLICT DO NOTHING
       RETURNING account_id`,
      [campaignId, accountId, now, max],
    );
    return rows.length > 0 || (await this.findPlayer(campaignId, accountId)) !== undefined;
  }

  async removePlayer(campaignId: string, accountId: string): Promise<boolean> {
    const rows = await this.db.query(
      "DELETE FROM campaign_players WHERE campaign_id = $1 AND account_id = $2 RETURNING account_id",
      [campaignId, accountId],
    );
    return rows.length > 0;
  }

  /** Every character of the campaign's players, newest first. */
  async listCampaignDrafts(campaignId: string): Promise<ReachableDraftRow[]> {
    return this.db.query<ReachableDraftRow>(
      `SELECT ${DRAFT_COLUMNS_D}, o.email AS owner_email, 'gameMaster' AS access
       FROM drafts d JOIN campaign_players p ON p.account_id = d.account_id
       JOIN accounts o ON o.id = d.account_id
       WHERE p.campaign_id = $1 ORDER BY d.updated_at DESC, d.id`,
      [campaignId],
    );
  }
}
