import { randomUUID } from "node:crypto";
import { printChoiceOf, printChoiceSchema, SHEET_DESIGNS } from "@builder/sheet/printouts";
import { z } from "zod";
import {
  accessKeyHash,
  accessKeyHint,
  MAX_KEY_NAME,
  MAX_KEYS_PER_ACCOUNT,
  newAccessKey,
} from "../../auth/access-keys.ts";
import { publicAccount, renewPassword, UI_LANGUAGES } from "../../auth/accounts.ts";
import { clearSessionCookie } from "../../auth/session.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";
import type { AccessKeyRow } from "../../store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const publicKey = (k: AccessKeyRow) => ({
  id: k.id,
  name: k.name,
  hint: k.hint,
  createdAt: k.created_at.toISOString(),
});

const newKeySchema = z.strictObject({
  /** What the key is for, in the owner's words ("the laptop at home"). Shown in the list only. */
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_KEY_NAME)
    // eslint-disable-next-line no-control-regex -- a name is one line of plain text
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "no control characters"),
});

const settingsSchema = z.strictObject({
  language: z.enum(UI_LANGUAGES).optional(),
  /** Unit per dimension; `null` goes back to the language's default. */
  units: z.record(z.string().max(50), z.string().max(20).nullable()).optional(),
  /** What the download dialog starts from next time; fields left out stay as they are. */
  print: printChoiceSchema.partial().optional(),
});

export const accountRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/account",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      return json(200, { account: publicAccount(account) });
    },
  },
  {
    method: "PATCH",
    path: "/api/account/settings",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const body = await readJson(ctx.req, settingsSchema);
      const units = { ...account.units };
      for (const [dimension, unit] of Object.entries(body.units ?? {})) {
        if (unit === null) {
          delete units[dimension];
          continue;
        }
        // Dimensions and units come from the packages; the builder knows none of its own.
        const offered = [...ctx.app.packages.packages.values()].some((p) =>
          p.pkg.units.dimensions[dimension]?.units.includes(unit),
        );
        if (!offered) throw new HttpError(422, "unknownUnit", { dimension, unit });
        units[dimension] = unit;
      }
      const design = body.print?.design;
      if (design !== undefined && !SHEET_DESIGNS.some((d) => d.id === design)) {
        throw new HttpError(422, "designNotAvailable", { design });
      }
      const updated = await ctx.app.store.updateSettings(
        account.id,
        body.language ?? account.language,
        units,
        { ...printChoiceOf(account.print_choice), ...body.print },
      );
      return json(200, { account: publicAccount(updated) });
    },
  },
  {
    method: "POST",
    path: "/api/account/password",
    handler: async (ctx) => {
      const session = await ctx.requireSession();
      await renewPassword(ctx.app, session.account, session.id);
      return json(202, { status: "sent" });
    },
  },
  {
    method: "GET",
    path: "/api/account/keys",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const keys = await ctx.app.store.listAccessKeys(account.id);
      return json(200, { keys: keys.map(publicKey) });
    },
  },
  {
    // The key is in this answer and nowhere else; the server keeps only its hash.
    method: "POST",
    path: "/api/account/keys",
    handler: async (ctx) => {
      const session = await ctx.requireSession();
      // Only the person makes keys: a key that leaked cannot make itself a successor
      // that outlives withdrawing it.
      if (session.via === "key") throw new HttpError(403, "keyCannotMakeKeys");
      const { name } = await readJson(ctx.req, newKeySchema);
      const key = newAccessKey();
      const row = await ctx.app.store.createAccessKey(
        {
          id: randomUUID(),
          account_id: session.account.id,
          key_hash: accessKeyHash(key),
          name,
          hint: accessKeyHint(key),
          created_at: ctx.app.now(),
        },
        MAX_KEYS_PER_ACCOUNT,
      );
      if (!row) throw new HttpError(422, "tooManyKeys", { max: MAX_KEYS_PER_ACCOUNT });
      return json(201, { key: { ...publicKey(row), secret: key } });
    },
  },
  {
    // Withdrawn at once: the next request with this key gets 401.
    method: "DELETE",
    path: "/api/account/keys/:id",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const id = ctx.params["id"]!;
      const deleted = UUID.test(id) && (await ctx.app.store.deleteAccessKey(id, account.id));
      // Someone else's key looks exactly like a missing one.
      if (!deleted) throw new HttpError(404, "keyNotFound");
      return json(204, null);
    },
  },
  {
    // "Delete my account" deletes everything: account, sessions, access keys, every draft.
    method: "DELETE",
    path: "/api/account",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      await readJson(ctx.req, z.strictObject({ confirm: z.literal(true) }));
      await ctx.app.store.deleteAccount(account.id);
      ctx.app.limiter.reset(`login:account:${account.email}`);
      ctx.app.limiter.reset(`password:account:${account.email}`);
      ctx.responseHeaders.delete("Set-Cookie");
      return json(204, null, { "Set-Cookie": clearSessionCookie(ctx.app.config.secureCookies) });
    },
  },
];
