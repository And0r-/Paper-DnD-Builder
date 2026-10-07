/**
 * Kept copies of the character sheet, and the play state.
 *
 * A copy is a sheet model a player keeps and changes freely, like a printed
 * page: any number, text or row, with no rule checks. It is made from the
 * original as it is now and never follows it again: a level, another
 * answer, a package update or another language leave it exactly as it
 * was. It keeps what the original was when it was made (level, when the
 * character last changed, package version); the original's sheet says the
 * same about itself, so the screen sees "the original changed since"
 * without comparing models.
 *
 * The play state is what is written and rubbed out at the table: field id
 * to a number, a text or a count of ticks. One per character, for the
 * original and every copy alike, so a level or a new copy keeps it. The
 * screen skips fields the shown sheet does not have and cuts ticks to what
 * a field holds; the state itself is never trimmed.
 *
 * Per account, the version opened last (`opened`): the screen opens it
 * again next time. Picking a version sets it, and so does making a copy.
 *
 * The builder never reads either. Access is the character's (owner, game
 * master of the owner's campaign, an access key of either); someone else's
 * character answers 404 like everywhere. Every write names the version it
 * was made on; a stale one is refused with the current state.
 */
import { MESSAGES, sheetModelSchema, type SheetModel } from "@builder/sheet";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { App } from "../../app.ts";
import type {
  CharacterStateRow,
  PlayValue,
  ReachableDraftRow,
  SheetCopyEntry,
  SheetCopyRow,
} from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import { nameSchema } from "./campaigns.ts";
import { loadDraft } from "./drafts.ts";
import { originalSheet } from "./print.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The screen offers no delete, so this is reached by changing the original
 * again and again; at the limit the original cannot be changed any more,
 * while every kept copy still can.
 */
export const MAX_COPIES_PER_CHARACTER = 50;
/** A demo sheet is a few dozen KiB; this leaves room for a long list of own rows. */
export const MAX_COPY_BYTES = 512 * 1024;
/** A request that sends a whole copy: the model and a little around it. */
const MAX_COPY_BODY_BYTES = MAX_COPY_BYTES + 4 * 1024;

export const MAX_STATE_FIELDS = 1000;

const version = z.number().int().min(1);

/** What the original was when a copy was made from it, or is now. */
type Stamp = { level: number; changedAt: string; packageVersion: string };

function copyEntry(c: SheetCopyEntry) {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    fromLevel: c.from_level,
    fromChangedAt: c.from_changed_at.toISOString(),
    fromPackageVersion: c.from_package_version,
    language: c.language,
    units: c.units,
    version: c.version,
  };
}

/**
 * A copy's model as it is kept: without `values`. Those are the original's
 * numbers and what follows from them; a copy is changed like paper, where
 * nothing follows, so they would be a second, older set of numbers next to
 * the ones on the page (a reader of the API, such as a later MCP server,
 * would get two).
 */
function kept<M extends object>(model: M): M {
  return { ...model, values: [] };
}

/** The copy with its model; the model's origin always says which copy it is. */
export function copyView(c: SheetCopyRow) {
  const model = {
    ...kept(c.model),
    origin: {
      kind: "copy",
      name: c.name,
      createdAt: c.created_at.toISOString(),
      fromLevel: c.from_level,
      fromPackageVersion: c.from_package_version,
      fromChangedAt: c.from_changed_at.toISOString(),
    },
  };
  return { copy: copyEntry(c), model };
}

/** The original as it is now, without building it: enough to compare with a copy's `from…`. */
function originalStamp(app: App, row: ReachableDraftRow) {
  return {
    level: row.document.level,
    changedAt: row.updated_at.toISOString(),
    /** Null while the character's package is not loaded. */
    packageVersion: app.packages.get(row.package_id)?.manifest.version ?? null,
    finished: row.finished_at !== null,
  };
}

function modelSize(model: unknown): number {
  return Buffer.byteLength(JSON.stringify(model));
}

function checkSize(model: unknown): void {
  if (modelSize(model) > MAX_COPY_BYTES) throw new HttpError(413, "copyTooLarge", { max: MAX_COPY_BYTES });
}

export async function loadCopy(
  ctx: RequestContext,
  draftId: string,
  id = ctx.params["copyId"]!,
): Promise<SheetCopyRow> {
  const copy = UUID.test(id) ? await ctx.app.store.findSheetCopy(draftId, id) : undefined;
  if (!copy) throw new HttpError(404, "copyNotFound");
  return copy;
}

/** "Meine Fassung vom 6. Oktober 2026", in the sheet's (the account's) language. */
export function defaultName(language: string, now: Date): string {
  const date = new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(now);
  return MESSAGES[language]!.copyName(date);
}

// --------------------------------------------------------------- play state

const playValueSchema = z.union([
  z.number().finite(),
  z.string().max(2000),
  z.strictObject({ checks: z.number().int().min(0).max(1000) }),
]);

const stateSchema = z
  .record(z.string().min(1).max(300), playValueSchema)
  .refine((s) => Object.keys(s).length <= MAX_STATE_FIELDS, `at most ${MAX_STATE_FIELDS} fields`);

function stateView(row: CharacterStateRow | undefined) {
  return {
    state: row?.state ?? {},
    /** 0 while nothing is stored yet; the first write names 0. */
    version: row?.version ?? 0,
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

/** The play state without any ticks: the rest. The builder does not know what a rest is; it only rubs out ticks. */
function withoutChecks(state: Record<string, PlayValue>): Record<string, PlayValue> {
  return Object.fromEntries(Object.entries(state).filter(([, v]) => typeof v !== "object"));
}

export const sheetCopyRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drafts/:id/sheet-copies",
    handler: async (ctx) => {
      const { row, viewer } = await loadDraft(ctx);
      const copies = await ctx.app.store.listSheetCopies(row.id);
      return json(200, {
        copies: copies.map(copyEntry),
        original: originalStamp(ctx.app, row),
        /** The copy this account opened last; null for the original. */
        opened: await ctx.app.store.findSheetView(viewer.id, row.id),
        max: MAX_COPIES_PER_CHARACTER,
      });
    },
  },
  {
    // A copy of the original as it is now, in the viewer's language and units.
    // With `model`, the copy is that model instead: the original as the viewer
    // saw it with the first change already in, so "the first change makes a
    // copy" is one request. It must be the original as it is now, else 409
    // `originalChanged` and the screen loads the original again.
    method: "POST",
    path: "/api/drafts/:id/sheet-copies",
    handler: async (ctx) => {
      const body = await readJson(
        ctx.req,
        z.strictObject({ name: nameSchema.optional(), model: sheetModelSchema.optional() }),
        MAX_COPY_BODY_BYTES,
      );
      const { model: original, row } = await originalSheet(ctx);
      if (original.origin.kind !== "original") throw new Error("the original sheet is not an original");
      const stamp: Stamp = {
        level: original.origin.level,
        changedAt: original.origin.changedAt!,
        packageVersion: original.origin.packageVersion,
      };
      let model: SheetModel = kept(original);
      if (body.model) {
        const seen = body.model.origin;
        if (
          seen.kind !== "original" ||
          seen.level !== stamp.level ||
          seen.changedAt !== stamp.changedAt ||
          seen.packageVersion !== stamp.packageVersion
        ) {
          throw new HttpError(409, "originalChanged", { original: originalStamp(ctx.app, row) });
        }
        model = kept(body.model);
      }
      checkSize(model);
      const now = ctx.app.now();
      const made = await ctx.app.store.createSheetCopy(
        {
          id: randomUUID(),
          draft_id: row.id,
          name: body.name ?? defaultName(model.language, now),
          created_at: now,
          updated_at: now,
          from_level: stamp.level,
          from_changed_at: new Date(stamp.changedAt),
          from_package_version: stamp.packageVersion,
          language: model.language,
          units: model.units,
          model,
          version: 1,
        },
        MAX_COPIES_PER_CHARACTER,
      );
      if (!made) throw new HttpError(409, "tooManyCopies", { max: MAX_COPIES_PER_CHARACTER });
      // Whoever made it is looking at it now: it opens next time.
      await ctx.app.store.putSheetView((await ctx.requireSession()).account.id, row.id, made.id, now);
      return json(201, copyView(made));
    },
  },
  {
    // Readable whatever the character is now: unfinished, its package gone, another language.
    method: "GET",
    path: "/api/drafts/:id/sheet-copies/:copyId",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx);
      return json(200, copyView(await loadCopy(ctx, row.id)));
    },
  },
  {
    // A new name, a new model, or both. The model is checked for shape only:
    // like on paper, anything may be written in, and nothing follows from it.
    method: "PUT",
    path: "/api/drafts/:id/sheet-copies/:copyId",
    handler: async (ctx) => {
      const body = await readJson(
        ctx.req,
        z
          .strictObject({ version, name: nameSchema.optional(), model: sheetModelSchema.optional() })
          .refine((b) => b.name !== undefined || b.model !== undefined, "name or model"),
        MAX_COPY_BODY_BYTES,
      );
      const { row } = await loadDraft(ctx);
      const copy = await loadCopy(ctx, row.id);
      if (copy.version !== body.version)
        throw new HttpError(409, "versionConflict", { current: copyView(copy) });
      if (body.model) checkSize(body.model);
      const updated = await ctx.app.store.updateSheetCopy(row.id, copy.id, body.version, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.model ? { model: kept(body.model) } : {}),
        now: ctx.app.now(),
      });
      if (!updated) {
        // Changed or deleted between our read and our write.
        throw new HttpError(409, "versionConflict", { current: copyView(await loadCopy(ctx, row.id)) });
      }
      return json(200, copyView(updated));
    },
  },
  {
    method: "DELETE",
    path: "/api/drafts/:id/sheet-copies/:copyId",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx);
      const id = ctx.params["copyId"]!;
      const deleted = UUID.test(id) && (await ctx.app.store.deleteSheetCopy(row.id, id));
      if (!deleted) throw new HttpError(404, "copyNotFound");
      return json(204, null);
    },
  },
  {
    // Which version this account opens next time: a copy of this character, or null for the original.
    method: "PUT",
    path: "/api/drafts/:id/sheet-view",
    handler: async (ctx) => {
      const body = await readJson(ctx.req, z.strictObject({ copyId: z.string().nullable() }));
      const { row, viewer } = await loadDraft(ctx);
      if (body.copyId !== null) {
        const copy = UUID.test(body.copyId)
          ? await ctx.app.store.findSheetCopy(row.id, body.copyId)
          : undefined;
        if (!copy) throw new HttpError(404, "copyNotFound");
      }
      await ctx.app.store.putSheetView(viewer.id, row.id, body.copyId, ctx.app.now());
      return json(200, { opened: body.copyId });
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id/state",
    handler: async (ctx) => {
      const { row } = await loadDraft(ctx);
      return json(200, stateView(await ctx.app.store.findCharacterState(row.id)));
    },
  },
  {
    // The whole play state at once, or `clearChecks` to rub out every tick.
    method: "PUT",
    path: "/api/drafts/:id/state",
    handler: async (ctx) => {
      const stateVersion = z.number().int().min(0);
      const body = await readJson(
        ctx.req,
        z.union([
          z.strictObject({ version: stateVersion, state: stateSchema }),
          z.strictObject({ version: stateVersion, clearChecks: z.literal(true) }),
        ]),
      );
      const { row } = await loadDraft(ctx);
      const current = await ctx.app.store.findCharacterState(row.id);
      if ((current?.version ?? 0) !== body.version) {
        throw new HttpError(409, "versionConflict", { current: stateView(current) });
      }
      const next = "state" in body ? body.state : withoutChecks(current?.state ?? {});
      const stored = await ctx.app.store.putCharacterState(row.id, body.version, next, ctx.app.now());
      if (!stored) {
        throw new HttpError(409, "versionConflict", {
          current: stateView(await ctx.app.store.findCharacterState(row.id)),
        });
      }
      return json(200, stateView(stored));
    },
  },
];
