/**
 * Character drafts. The draft lives on the server as one document; the
 * browser keeps no state of its own. Every change names the version it was
 * made on. If the draft moved on in the meantime (another tab, later a
 * helper on the same draft), the change is refused with the current state.
 */
import {
  applyChange,
  evaluateDraft,
  levelUp,
  levelUpState,
  newDraft,
  summarize,
  type DraftChange,
} from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { App } from "../../app.ts";
import type { DraftRow } from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const version = z.number().int().min(1);

/**
 * The draft as every route answers it. `raisedFrom` names the level a raise
 * started from when the draft no longer keeps it (a raise that finished the
 * character at once), so the level-up answer always says what it brought.
 */
export function draftView(row: DraftRow, pkg: ContentPackage | undefined, raisedFrom?: number) {
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
      answers: row.document.answers,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
    },
    /** False if the draft's package is not loaded right now; the draft is kept and shown again once it is. */
    packageAvailable: pkg !== undefined,
    evaluation,
    summary: pkg && evaluation ? summarize(pkg, row.document, evaluation) : null,
    /** While a character is being raised: the new steps and choices, and what is still open. */
    levelUp: evaluation && from !== undefined ? levelUpState(evaluation, from) : null,
  };
}

export async function loadDraft(ctx: RequestContext): Promise<{ row: DraftRow; accountId: string }> {
  const { account } = await ctx.requireSession();
  const id = ctx.params["id"]!;
  const row = UUID.test(id) ? await ctx.app.store.findDraft(id, account.id) : undefined;
  // Someone else's draft looks exactly like a missing one.
  if (!row) throw new HttpError(404, "draftNotFound");
  return { row, accountId: account.id };
}

export function packageOf(app: App, row: DraftRow): ContentPackage {
  const pkg = app.packages.get(row.package_id);
  if (!pkg) throw new HttpError(409, "packageUnavailable", { packageId: row.package_id });
  return pkg;
}

function conflict(row: DraftRow, pkg: ContentPackage): HttpError {
  return new HttpError(409, "versionConflict", { current: draftView(row, pkg) });
}

/**
 * The one way a stored draft changes. A finished character stays finished
 * while it is complete; a change that leaves something open makes it a
 * draft again.
 */
async function change(
  ctx: RequestContext,
  expectedVersion: number,
  edit: (
    pkg: ContentPackage,
    row: DraftRow,
  ) => { doc: DraftRow["document"]; finish?: boolean; raisedFrom?: number | undefined },
): Promise<Response> {
  const { row, accountId } = await loadDraft(ctx);
  const pkg = packageOf(ctx.app, row);
  if (row.version !== expectedVersion) throw conflict(row, pkg);
  const edited = edit(pkg, row);
  const complete = evaluateDraft(pkg, edited.doc).complete;
  const now = ctx.app.now();
  const finishedAt = edited.finish ? now : complete ? row.finished_at : null;
  // A raise ends when the character is finished again.
  const { levelBefore: _, ...rest } = edited.doc;
  const doc = finishedAt ? rest : edited.doc;
  const updated = await ctx.app.store.updateDraft(row.id, accountId, expectedVersion, {
    document: doc,
    finishedAt,
    packageVersion: pkg.manifest.version,
    now,
  });
  if (!updated) {
    // Changed between our read and our write.
    const current = await ctx.app.store.findDraft(row.id, accountId);
    if (!current) throw new HttpError(404, "draftNotFound");
    throw conflict(current, pkg);
  }
  ctx.app.draftEvents.publish({ draftId: updated.id, accountId, version: updated.version });
  return json(200, draftView(updated, pkg, edited.raisedFrom));
}

function applyOrReject(pkg: ContentPackage, row: DraftRow, c: DraftChange) {
  const r = applyChange(pkg, row.document, c);
  if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
  return { doc: r.doc };
}

export const draftRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drafts",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const rows = await ctx.app.store.listDrafts(account.id);
      const drafts = rows.map((row) => {
        const { draft, packageAvailable, summary } = draftView(row, ctx.app.packages.get(row.package_id));
        return { ...draft, packageAvailable, summary };
      });
      return json(200, { drafts });
    },
  },
  {
    method: "POST",
    path: "/api/drafts",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const body = await readJson(
        ctx.req,
        z.strictObject({ packageId: z.string().max(100), level: z.number().int().optional() }),
      );
      const pkg = ctx.app.packages.get(body.packageId);
      if (!pkg) throw new HttpError(404, "packageNotFound");
      const r = newDraft(pkg, body.level);
      if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
      const row = await ctx.app.store.createDraft({
        id: randomUUID(),
        account_id: account.id,
        package_id: pkg.manifest.id,
        package_version: pkg.manifest.version,
        version: 1,
        document: r.doc,
        created_at: ctx.app.now(),
      });
      return json(201, draftView(row, pkg));
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx);
      return json(200, draftView(row, ctx.app.packages.get(row.package_id)));
    },
  },
  {
    // Changes of the draft as a whole; for now the level.
    method: "PATCH",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, z.strictObject({ version, level: z.number().int() }));
      return change(ctx, body.version, (pkg, row) =>
        applyOrReject(pkg, row, { type: "setLevel", level: body.level }),
      );
    },
  },
  {
    // Answer one choice; `answer: null` removes the answer.
    method: "PUT",
    path: "/api/drafts/:id/answers/:choice",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, z.strictObject({ version, answer: z.unknown() }));
      const choice = ctx.params["choice"]!;
      return change(ctx, body.version, (pkg, row) =>
        applyOrReject(pkg, row, { type: "answer", choice, answer: body.answer ?? null }),
      );
    },
  },
  {
    // All picks of a step with one shared list; the core spreads them over the step's choices.
    method: "PUT",
    path: "/api/drafts/:id/pools/:step",
    handler: async (ctx) => {
      const body = await readJson(
        ctx.req,
        z.strictObject({ version, picks: z.array(z.string().min(1).max(200)).max(200) }),
      );
      const step = ctx.params["step"]!;
      return change(ctx, body.version, (pkg, row) =>
        applyOrReject(pkg, row, { type: "pool", step, picks: body.picks }),
      );
    },
  },
  {
    // Raise a finished character to a higher level. Every answer stays; only
    // what the new levels add is open. With nothing to answer, the character
    // is finished again at once.
    method: "POST",
    path: "/api/drafts/:id/level-up",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, z.strictObject({ version, level: z.number().int() }));
      return change(ctx, body.version, (pkg, row) => {
        // A raise that is not finished yet may go higher still; any other draft is built first.
        if (!row.finished_at && row.document.levelBefore === undefined) {
          throw new HttpError(409, "notFinished", { open: evaluateDraft(pkg, row.document).open });
        }
        const r = levelUp(pkg, row.document, body.level);
        if (!r.ok) throw new HttpError(422, "changeRejected", { reason: r.error });
        return {
          doc: r.doc,
          finish: evaluateDraft(pkg, r.doc).complete,
          raisedFrom: r.doc.levelBefore,
        };
      });
    },
  },
  {
    method: "POST",
    path: "/api/drafts/:id/finish",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, z.strictObject({ version }));
      return change(ctx, body.version, (pkg, row) => {
        const ev = evaluateDraft(pkg, row.document);
        if (!ev.complete) throw new HttpError(422, "incomplete", { open: ev.open });
        return { doc: row.document, finish: true };
      });
    },
  },
  {
    method: "DELETE",
    path: "/api/drafts/:id",
    handler: async (ctx) => {
      const { row, accountId } = await loadDraft(ctx);
      await ctx.app.store.deleteDraft(row.id, accountId);
      return json(204, null);
    },
  },
];
