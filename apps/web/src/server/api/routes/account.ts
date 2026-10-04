import { z } from "zod";
import { publicAccount, renewPassword, UI_LANGUAGES } from "../../auth/accounts.ts";
import { clearSessionCookie } from "../../auth/session.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";

const settingsSchema = z.strictObject({
  language: z.enum(UI_LANGUAGES).optional(),
  /** Unit per dimension; `null` goes back to the language's default. */
  units: z.record(z.string().max(50), z.string().max(20).nullable()).optional(),
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
      const updated = await ctx.app.store.updateSettings(
        account.id,
        body.language ?? account.language,
        units,
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
    // "Delete my account" deletes everything: account, sessions, every draft.
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
