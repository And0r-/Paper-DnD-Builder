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
  /** The last download's choice as stored; read through `printChoiceOf`. */
  print_choice: unknown;
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

/** A kept copy of a character's sheet, without its model (the list). */
export type SheetCopyEntry = {
  id: string;
  draft_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  from_level: number;
  from_changed_at: Date;
  from_package_version: string;
  language: string;
  units: Record<string, string>;
  version: number;
};

/** The model is the sheet model as stored; it is checked on the way in, not on the way out. */
export type SheetCopyRow = SheetCopyEntry & { model: Record<string, unknown> };

/** A value of the play state: a number, a text, or a count of ticks. */
export type PlayValue = number | string | { checks: number };

export type CharacterStateRow = {
  draft_id: string;
  state: Record<string, PlayValue>;
  version: number;
  updated_at: Date;
};

const ACCESS_KEY_COLUMNS = "id, hint, created_at";
const ACCOUNT_COLUMNS = "id, email, password_hash, language, units, print_choice, created_at";
const DRAFT_COLUMNS =
  "id, account_id, package_id, package_version, version, document, finished_at, created_at, updated_at";
const COPY_ENTRY_COLUMNS =
  "id, draft_id, name, created_at, updated_at, from_level, from_changed_at, from_package_version, language, units, version";
const COPY_COLUMNS = `${COPY_ENTRY_COLUMNS}, model`;
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
  async createAccount(a: Omit<AccountRow, "units" | "print_choice">): Promise<AccountRow | undefined> {
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
    printChoice: object,
  ): Promise<AccountRow> {
    const rows = await this.db.query<AccountRow>(
      `UPDATE accounts SET language = $2, units = $3::jsonb, print_choice = $4::jsonb
       WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [accountId, language, units, printChoice],
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
      `SELECT s.id AS session_id, s.refreshed_at, a.id, a.email, a.password_hash, a.language, a.units, a.print_choice, a.created_at
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
      `SELECT k.id AS key_id, a.id, a.email, a.password_hash, a.language, a.units, a.print_choice, a.created_at
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
  // ------------------------------------------------------------ sheet copies
  // Every statement names the draft: a copy is only reached through its
  // character, whose access the route has checked.

  /** Inserts a copy unless the character already has `max`; returns undefined then. */
  async createSheetCopy(c: SheetCopyRow, max: number): Promise<SheetCopyRow | undefined> {
    const rows = await this.db.query<SheetCopyRow>(
      `INSERT INTO sheet_copies (id, draft_id, name, created_at, updated_at, from_level, from_changed_at,
         from_package_version, language, units, model, version)
       SELECT $1, $2, $3, $4, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 1
       WHERE (SELECT count(*) FROM sheet_copies WHERE draft_id = $2) < $11
       RETURNING ${COPY_COLUMNS}`,
      [
        c.id,
        c.draft_id,
        c.name,
        c.created_at,
        c.from_level,
        c.from_changed_at,
        c.from_package_version,
        c.language,
        c.units,
        c.model,
        max,
      ],
    );
    return rows[0];
  }

  async listSheetCopies(draftId: string): Promise<SheetCopyEntry[]> {
    return this.db.query<SheetCopyEntry>(
      `SELECT ${COPY_ENTRY_COLUMNS} FROM sheet_copies WHERE draft_id = $1 ORDER BY created_at, id`,
      [draftId],
    );
  }

  async findSheetCopy(draftId: string, id: string): Promise<SheetCopyRow | undefined> {
    const rows = await this.db.query<SheetCopyRow>(
      `SELECT ${COPY_COLUMNS} FROM sheet_copies WHERE id = $1 AND draft_id = $2`,
      [id, draftId],
    );
    return rows[0];
  }

  /**
   * Stores a new name and/or model only if the copy is still at
   * `expectedVersion`. Returns undefined when it moved on or is gone.
   */
  async updateSheetCopy(
    draftId: string,
    id: string,
    expectedVersion: number,
    next: { name?: string; model?: Record<string, unknown>; now: Date },
  ): Promise<SheetCopyRow | undefined> {
    const rows = await this.db.query<SheetCopyRow>(
      `UPDATE sheet_copies
       SET name = COALESCE($4, name), model = COALESCE($5::jsonb, model), updated_at = $6, version = version + 1
       WHERE id = $1 AND draft_id = $2 AND version = $3
       RETURNING ${COPY_COLUMNS}`,
      [id, draftId, expectedVersion, next.name ?? null, next.model ?? null, next.now],
    );
    return rows[0];
  }

  async deleteSheetCopy(draftId: string, id: string): Promise<boolean> {
    const rows = await this.db.query(
      "DELETE FROM sheet_copies WHERE id = $1 AND draft_id = $2 RETURNING id",
      [id, draftId],
    );
    return rows.length > 0;
  }

  /** The copy `accountId` opened last on this character; null for the original or nothing stored. */
  async findSheetView(accountId: string, draftId: string): Promise<string | null> {
    const rows = await this.db.query<{ copy_id: string | null }>(
      "SELECT copy_id FROM sheet_views WHERE account_id = $1 AND draft_id = $2",
      [accountId, draftId],
    );
    return rows[0]?.copy_id ?? null;
  }

  /** Remembers the version opened last; a copy must be one of this character's (checked by the caller). */
  async putSheetView(accountId: string, draftId: string, copyId: string | null, now: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO sheet_views (account_id, draft_id, copy_id, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, draft_id) DO UPDATE SET copy_id = $3, updated_at = $4`,
      [accountId, draftId, copyId, now],
    );
  }

  // -------------------------------------------------------------- play state

  async findCharacterState(draftId: string): Promise<CharacterStateRow | undefined> {
    const rows = await this.db.query<CharacterStateRow>(
      "SELECT draft_id, state, version, updated_at FROM character_states WHERE draft_id = $1",
      [draftId],
    );
    return rows[0];
  }

  /**
   * Stores the play state only if it is still at `expectedVersion`; version
   * 0 is "none stored yet". Returns undefined when someone else wrote first.
   */
  async putCharacterState(
    draftId: string,
    expectedVersion: number,
    state: Record<string, PlayValue>,
    now: Date,
  ): Promise<CharacterStateRow | undefined> {
    const rows =
      expectedVersion === 0
        ? await this.db.query<CharacterStateRow>(
            `INSERT INTO character_states (draft_id, state, version, updated_at)
             VALUES ($1, $2::jsonb, 1, $3)
             ON CONFLICT (draft_id) DO NOTHING
             RETURNING draft_id, state, version, updated_at`,
            [draftId, state, now],
          )
        : await this.db.query<CharacterStateRow>(
            `UPDATE character_states SET state = $3::jsonb, updated_at = $4, version = version + 1
             WHERE draft_id = $1 AND version = $2
             RETURNING draft_id, state, version, updated_at`,
            [draftId, expectedVersion, state, now],
          );
    return rows[0];
  }
}
