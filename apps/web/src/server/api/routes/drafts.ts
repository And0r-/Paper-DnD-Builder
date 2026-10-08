/**
 * Character drafts. The draft lives on the server as one document; the
 * browser keeps no state of its own. Every change names the version it was
 * made on. If the draft moved on in the meantime (another tab, later a
 * helper on the same draft), the change is refused with the current state.
 */
import {
  applyChange,
  evaluateDraft,
  explainValue,
  levelUp,
  levelUpState,
  newDraft,
  summarize,
  type DraftChange,
} from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { App, ChangeSource } from "../../app.ts";
import type { AccountRow, DraftRow, ReachableDraftRow } from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const version = z.number().int().min(1);

/**
 * The draft as every route answers it. `raisedFrom` names the level a raise
 * started from when the draft no longer keeps it (a raise that finished the
 * character at once), so the level-up answer always says what it brought.
 */
export function draftView(row: ReachableDraftRow, pkg: ContentPackage | undefined, raisedFrom?: number) {
  const evaluation = pkg ? evaluateDraft(pkg, row.document) : null;
  const from = row.document.levelBefore ?? raisedFrom;
  return {
    draft: {
      id: row.id,
      packageId: row.package_id,
      packageVersion: row.package_version,
      version: row.version,
      status: row.finished_at ? "finished" : "draft",
      level: row.document.level,
      /** The level a raise started from, until the character is finished again. */
      levelBefore: row.document.levelBefore ?? null,
      /** The campaign the character belongs to; null for none. */
      campaignId: row.campaign_id,
      answers: row.document.answers,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
      /** Whose character it is. A game master's view shows the player here. */
      owner: { name: row.owner_name },
      /** Why the viewer may see it: their own, or a player's in a campaign they lead. */
      access: row.access,
    },
    /** False if the draft's package is not loaded right now; the draft is kept and shown again once it is. */
    packageAvailable: pkg !== undefined,
    evaluation,
    summary: pkg && evaluation ? summarize(pkg, row.document, evaluation) : null,
    /** While a character is being raised: the new steps and choices, and what is still open. */
    levelUp: evaluation && from !== undefined ? levelUpState(evaluation, from) : null,
  };
}

/** One's own drafts, in the shape `draftView` takes. */
export function ownDraft(row: DraftRow, account: AccountRow): ReachableDraftRow {
  return { ...row, owner_name: account.name, access: "owner" };
}

/** A draft in a list: the draft's fields with `packageAvailable` and `summary`. */
export function listEntry(app: App, row: ReachableDraftRow) {
  const { draft, packageAvailable, summary } = draftView(row, app.packages.get(row.package_id));
  return { ...draft, packageAvailable, summary };
}

/** A help link's token: 128 random bits, 22 characters base64url. */
export const HELP_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/**
 * The draft `id` if `viewerId` may reach it: their own, one a player put
 * into a campaign they lead (see `Store.findReachableDraft`), or, with
 * `helpToken`, the one its working help link opens. Undefined for anyone else's.
 */
export async function findDraftFor(
  app: App,
  id: string,
  viewerId: string,
  helpToken?: string | null,
): Promise<ReachableDraftRow | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await app.store.findReachableDraft(id, viewerId);
  if (row || !helpToken || !HELP_TOKEN.test(helpToken)) return row;
  return app.store.findHelpedDraft(id, helpToken, app.now());
}

/**
 * The draft of the URL, if the viewer may reach it. With `helpers`, a
 * help link in `?help=` opens it too: only the routes that open and change
 * a draft take one.
 */
export async function loadDraft(
  ctx: RequestContext,
  options: { helpers?: boolean } = {},
): Promise<{ row: ReachableDraftRow; viewer: AccountRow }> {
  const { account } = await ctx.requireSession();
  const help = options.helpers ? ctx.url.searchParams.get("help") : null;
  const row = await findDraftFor(ctx.app, ctx.params["id"]!, account.id, help);
  // Someone else's draft looks exactly like a missing one.
  if (!row) throw new HttpError(404, "draftNotFound");
  return { row, viewer: account };
}

export function packageOf(app: App, row: DraftRow): ContentPackage {
  const pkg = app.packages.get(row.package_id);
  if (!pkg) throw new HttpError(409, "packageUnavailable", { packageId: row.package_id });
  return pkg;
}

/** What a change does to the draft: the new document, and whether that finishes the character. */
export type DraftEdit = (
  pkg: ContentPackage,
  row: DraftRow,
) => { doc: DraftRow["document"]; finish?: boolean; raisedFrom?: number | undefined };

export type Committed =
  | { ok: true; row: ReachableDraftRow; raisedFrom?: number | undefined }
  | { ok: false; current: ReachableDraftRow };

/**
 * The one way a stored draft changes, for the HTTP API and the live
 * channel alike. A finished character stays finished while it is
 * complete; a change that leaves something open makes it a draft again.
 * If the draft is no longer at `expectedVersion`, nothing changes and the
 * current state comes back. `reload` reads the draft again as the viewer
 * may see it, for when it changed between our read and our write.
 */
export async function commitChange(
  app: App,
  row: ReachableDraftRow,
  expectedVersion: number,
  edit: DraftEdit,
  reload: () => Promise<ReachableDraftRow | undefined>,
  source?: ChangeSource,
): Promise<Committed> {
  // The draft stays its owner's, whoever changes it.
  const accountId = row.account_id;
  const pkg = packageOf(app, row);
  if (row.version !== expectedVersion) return { ok: false, current: row };
  const edited = edit(pkg, row);
  const complete = evaluateDraft(pkg, edited.doc).complete;
  const now = app.now();
  const finishedAt = edited.finish ? now : complete ? row.finished_at : null;
  // A raise ends when the character is finished again.
  const { levelBefore: _, ...rest } = edited.doc;
  const doc = finishedAt ? rest : edited.doc;
  const updated = await app.store.updateDraft(row.id, accountId, expectedVersion, {
    document: doc,
    finishedAt,
    packageVersion: pkg.manifest.version,
    now,
  });
  if (!updated) {
    // Changed between our read and our write.
    const current = await reload();
    if (!current) throw new HttpError(404, "draftNotFound");
    return { ok: false, current };
  }
  app.draftEvents.publish({
    kind: "changed",
    draftId: updated.id,
    accountId,
    version: updated.version,
    row: updated,
    raisedFrom: edited.raisedFrom,
    source,
  });
  return {
    ok: true,
    row: { ...updated, owner_name: row.owner_name, access: row.access },
    raisedFrom: edited.raisedFrom,
  };
}

async function change(ctx: RequestContext, expectedVersion: number, edit: DraftEdit): Promise<Response> {
  const { row, viewer } = await loadDraft(ctx, { helpers: true });
  const help = ctx.url.searchParams.get("help");
  const done = await commitChange(ctx.app, row, expectedVersion, edit, () =>
    findDraftFor(ctx.app, row.id, viewer.id, help),
  );
  const pkg = packageOf(ctx.app, row);
  if (!done.ok) throw new HttpError(409, "versionConflict", { current: draftView(done.current, pkg) });
  return json(200, draftView(done.row, pkg, done.raisedFrom));
}

function applyOrReject(pkg: ContentPackage, row: DraftRow, c: DraftChange) {
  const r = applyChange(pkg, row.document, c);
  if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
  return { doc: r.doc };
}

/**
 * The changes a draft takes, by the API's routes and by the live channel's
 * messages alike. Each throws an HttpError when the change is refused.
 */
export const edits = {
  setLevel:
    (level: number): DraftEdit =>
    (pkg, row) =>
      applyOrReject(pkg, row, { type: "setLevel", level }),
  answer:
    (choice: string, answer: unknown): DraftEdit =>
    (pkg, row) =>
      applyOrReject(pkg, row, { type: "answer", choice, answer: answer ?? null }),
  pool:
    (step: string, picks: string[]): DraftEdit =>
    (pkg, row) =>
      applyOrReject(pkg, row, { type: "pool", step, picks }),
  levelUp:
    (level: number): DraftEdit =>
    (pkg, row) => {
      // A raise that is not finished yet may go higher still; any other draft is built first.
      if (!row.finished_at && row.document.levelBefore === undefined) {
        throw new HttpError(409, "notFinished", { open: evaluateDraft(pkg, row.document).open });
      }
      const r = levelUp(pkg, row.document, level);
      if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
      return {
        doc: r.doc,
        finish: evaluateDraft(pkg, r.doc).complete,
        raisedFrom: r.doc.levelBefore,
      };
    },
  finish: (): DraftEdit => (pkg, row) => {
    const ev = evaluateDraft(pkg, row.document);
    if (!ev.complete) throw new HttpError(422, "incomplete", { open: ev.open });
    return { doc: row.document, finish: true };
  },
};

/** The bodies of the changing routes; the live channel's messages carry the same fields. */
export const changeBodies = {
  setLevel: z.strictObject({ version, level: z.number().int() }),
  answer: z.strictObject({ version, answer: z.unknown() }),
  pool: z.strictObject({ version, picks: z.array(z.string().min(1).max(200)).max(200) }),
  levelUp: z.strictObject({ version, level: z.number().int() }),
  finish: z.strictObject({ version }),
};

export const newDraftSchema = z.strictObject({
  packageId: z.string().max(100),
  level: z.number().int().optional(),
  /** A campaign the owner plays in or leads; none if left out or null. */
  campaignId: z.string().regex(UUID).nullable().optional(),
});

/**
 * A new character for `owner`; a game master makes one for a player this
 * way, too, and passes their campaign: the character belongs to it.
 */
export async function createDraft(
  ctx: RequestContext,
  owner: { id: string; name: string },
  access: ReachableDraftRow["access"],
  ledCampaignId?: string,
): Promise<Response> {
  const body = await readJson(ctx.req, newDraftSchema);
  let campaignId = body.campaignId ?? null;
  if (ledCampaignId) {
    if (campaignId && campaignId !== ledCampaignId) throw new HttpError(404, "campaignNotFound");
    campaignId = ledCampaignId;
  } else if (campaignId && !(await ctx.app.store.isMember(campaignId, owner.id))) {
    // Only a campaign the owner plays in or leads; any other looks missing.
    throw new HttpError(404, "campaignNotFound");
  }
  const pkg = ctx.app.packages.get(body.packageId);
  if (!pkg) throw new HttpError(404, "packageNotFound");
  const r = newDraft(pkg, body.level);
  if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
  const row = await ctx.app.store.createDraft({
    id: randomUUID(),
    account_id: owner.id,
    package_id: pkg.manifest.id,
    package_version: pkg.manifest.version,
    version: 1,
    document: r.doc,
    campaign_id: campaignId,
    created_at: ctx.app.now(),
  });
  return json(201, draftView({ ...row, owner_name: owner.name, access }, pkg));
}

export const draftRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drafts",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const rows = await ctx.app.store.listDrafts(account.id);
      return json(200, { drafts: rows.map((row) => listEntry(ctx.app, ownDraft(row, account))) });
    },
  },
  {
    method: "POST",
    path: "/api/drafts",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      return createDraft(ctx, account, "owner");
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx, { helpers: true });
      return json(200, draftView(row, ctx.app.packages.get(row.package_id)));
    },
  },
  {
    // Where one number comes from: the parts the screen explains it with,
    // as data (ids, not words), so a tool reads the same answer.
    method: "GET",
    path: "/api/drafts/:id/explain/:value",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx, { helpers: true });
      const pkg = packageOf(ctx.app, row);
      const value = ctx.params["value"]!;
      const ev = evaluateDraft(pkg, row.document);
      if (!Object.hasOwn(ev.values, value)) throw new HttpError(404, "valueNotFound");
      // No parts when they do not add up to the number (a minimum or maximum cut it).
      const parts = explainValue(pkg, ev, value)?.parts ?? null;
      return json(200, { value, total: ev.values[value], parts });
    },
  },
  {
    // Changes of the draft as a whole; for now the level.
    method: "PATCH",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, changeBodies.setLevel);
      return change(ctx, body.version, edits.setLevel(body.level));
    },
  },
  {
    // Answer one choice; `answer: null` removes the answer.
    method: "PUT",
    path: "/api/drafts/:id/answers/:choice",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, changeBodies.answer);
      return change(ctx, body.version, edits.answer(ctx.params["choice"]!, body.answer));
    },
  },
  {
    // All picks of a step with one shared list; the core spreads them over the step's choices.
    method: "PUT",
    path: "/api/drafts/:id/pools/:step",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, changeBodies.pool);
      return change(ctx, body.version, edits.pool(ctx.params["step"]!, body.picks));
    },
  },
  {
    // Raise a finished character to a higher level. Every answer stays; only
    // what the new levels add is open. With nothing to answer, the character
    // is finished again at once.
    method: "POST",
    path: "/api/drafts/:id/level-up",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, changeBodies.levelUp);
      return change(ctx, body.version, edits.levelUp(body.level));
    },
  },
  {
    method: "POST",
    path: "/api/drafts/:id/finish",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, changeBodies.finish);
      return change(ctx, body.version, edits.finish());
    },
  },
  {
    // The owner puts the character into a campaign they play in or lead,
    // or into none. The character itself does not change: its version stays.
    method: "PUT",
    path: "/api/drafts/:id/campaign",
    handler: async (ctx) => {
      const { row, viewer } = await loadDraft(ctx);
      if (row.access !== "owner") throw new HttpError(403, "ownerOnly");
      const body = await readJson(ctx.req, z.strictObject({ campaignId: z.string().regex(UUID).nullable() }));
      const set = await ctx.app.store.setDraftCampaign(row.id, viewer.id, body.campaignId);
      if (!set) throw new HttpError(404, "campaignNotFound");
      // A game master may have lost the character, or gained it.
      ctx.app.draftEvents.publish({ kind: "access", draftId: row.id });
      return json(
        200,
        draftView({ ...row, campaign_id: body.campaignId }, ctx.app.packages.get(row.package_id)),
      );
    },
  },
  {
    // Only the owner deletes: a game master may change a character, not take it away.
    method: "DELETE",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx);
      if (row.access !== "owner") throw new HttpError(403, "ownerOnly");
      await ctx.app.store.deleteDraft(row.id, row.account_id);
      ctx.app.draftEvents.publish({ kind: "deleted", draftId: row.id });
      return json(204, null);
    },
  },
];
