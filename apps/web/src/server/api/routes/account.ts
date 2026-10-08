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
import {
  emailSchema,
  makePassword,
  MAX_PASSWORDS_PER_ACCOUNT,
  nameSchema,
  publicAccount,
  UI_LANGUAGES,
} from "../../auth/accounts.ts";
import { clearSessionCookie } from "../../auth/session.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import type { AccessKeyRow } from "../../store.ts";
import { freshPassword, publicPassword } from "./auth.ts";

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

/** Makes a key for the account; the plain key is returned here and stored nowhere. */
async function makeKey(ctx: RequestContext, accountId: string, name: string) {
  const key = newAccessKey();
  const row = await ctx.app.store.createAccessKey(
    {
      id: randomUUID(),
      account_id: accountId,
      key_hash: accessKeyHash(key),
      name,
      hint: accessKeyHint(key),
      created_at: ctx.app.now(),
    },
    MAX_KEYS_PER_ACCOUNT,
  );
  if (!row) throw new HttpError(422, "tooManyKeys", { max: MAX_KEYS_PER_ACCOUNT });
  return { row, secret: key };
}

const settingsSchema = z.strictObject({
  name: nameSchema.optional(),
  /** The address for a way back in; `null` removes it. */
  email: emailSchema.nullable().optional(),
  language: z.enum(UI_LANGUAGES).optional(),
  /** Unit per dimension; `null` goes back to the language's default. */
  units: z.record(z.string().max(50), z.string().max(20).nullable()).optional(),
  /** What the download dialog starts from next time; fields left out stay as they are. */
  print: printChoiceSchema.partial().optional(),
  /** `false` ("Later"): no more reminder to add an address, on any device. It does not come back. */
  mailReminder: z.literal(false).optional(),
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
      if (body.name !== undefined || body.email !== undefined) {
        await ctx.app.store.updateIdentity(
          account.id,
          body.name ?? account.name,
          body.email === undefined ? account.email : body.email,
        );
      }
      if (body.mailReminder === false) await ctx.app.store.turnMailReminderOff(account.id);
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
    method: "GET",
    path: "/api/account/passwords",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const passwords = await ctx.app.store.listPasswords(account.id);
      return json(200, { passwords: passwords.map(publicPassword) });
    },
  },
  {
    // The password is in this answer and nowhere else; the server keeps only its hash.
    method: "POST",
    path: "/api/account/passwords",
    handler: async (ctx) => {
      const session = await ctx.requireSession();
      // Only the person makes passwords: a leaked key cannot turn itself into a login.
      if (session.via === "key") throw new HttpError(403, "keyCannotMakePasswords");
      const body = await readJson(ctx.req, z.strictObject({ name: nameSchema.optional() }));
      const made = await makePassword(ctx.app, session.account, body.name ?? null);
      if (!made) throw new HttpError(422, "tooManyPasswords", { max: MAX_PASSWORDS_PER_ACCOUNT });
      return json(201, { password: freshPassword(made) });
    },
  },
  {
    // Stops working at once. The last one stays: without it, nobody gets back in.
    method: "DELETE",
    path: "/api/account/passwords/:id",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      const id = ctx.params["id"]!;
      const result = UUID.test(id) ? await ctx.app.store.deletePassword(id, account.id) : "missing";
      // Someone else's password looks exactly like a missing one.
      if (result === "missing") throw new HttpError(404, "passwordNotFound");
      if (result === "last") throw new HttpError(422, "lastPassword");
      return json(204, null);
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
      const { row, secret } = await makeKey(ctx, session.account.id, name);
      return json(201, { key: { ...publicKey(row), secret } });
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
      // A program's live connections with this key end at once.
      ctx.app.draftEvents.publish({ kind: "access" });
      return json(204, null);
    },
  },
  {
    // "Delete my account" deletes everything: account, sessions, passwords, access keys, every draft.
    method: "DELETE",
    path: "/api/account",
    handler: async (ctx) => {
      const { account } = await ctx.requireSession();
      await readJson(ctx.req, z.strictObject({ confirm: z.literal(true) }));
      await ctx.app.store.deleteAccount(account.id);
      // Their live connections end, and a game master's on their characters.
      ctx.app.draftEvents.publish({ kind: "access" });
      if (account.email) ctx.app.limiter.reset(`login:account:${account.email}`);
      ctx.responseHeaders.delete("Set-Cookie");
      return json(204, null, { "Set-Cookie": clearSessionCookie(ctx.app.config.secureCookies) });
    },
  },
];
