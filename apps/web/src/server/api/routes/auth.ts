import { z } from "zod";
import {
  emailSchema,
  login,
  nameSchema,
  passwordInputSchema,
  publicAccount,
  requestReset,
  signup,
  useReset,
} from "../../auth/accounts.ts";
import { clearSessionCookie, readSessionToken, sessionCookie, sessionId } from "../../auth/session.ts";
import type { PasswordRow } from "../../store.ts";
import { clientIp, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";

/** A password as its owner sees it in the list. */
export const publicPassword = (p: PasswordRow) => ({
  id: p.id,
  name: p.name,
  origin: p.origin,
  createdAt: p.created_at.toISOString(),
});

/** The one answer that holds a plain password: the server keeps only its hash. */
export const freshPassword = (p: { row: PasswordRow; secret: string }) => ({
  ...publicPassword(p.row),
  secret: p.secret,
});

export const authRoutes: Route[] = [
  {
    // A new account, its first password (shown once, in this answer) and a session.
    method: "POST",
    path: "/api/auth/signup",
    handler: async ({ app, req }) => {
      const body = await readJson(
        req,
        z.strictObject({
          name: nameSchema,
          /** Only a way back in; no mail is sent to it now. */
          email: emailSchema.nullable().optional(),
          language: z.string().max(10).optional(),
        }),
      );
      const { account, password, token } = await signup(app, body, clientIp(req));
      return json(
        201,
        { account: publicAccount(account), password: freshPassword(password) },
        { "Set-Cookie": sessionCookie(token, app.config.secureCookies) },
      );
    },
  },
  {
    // Any account: a name or an address, and a password. An account from
    // before, once: its old password is swapped for a new one, shown here.
    method: "POST",
    path: "/api/auth/login",
    handler: async ({ app, req }) => {
      const body = await readJson(
        req,
        z.strictObject({ login: z.string().trim().min(1).max(254), password: passwordInputSchema }),
      );
      const { account, password, token } = await login(app, body.login, body.password, clientIp(req));
      return json(
        200,
        { account: publicAccount(account), ...(password && { password: freshPassword(password) }) },
        { "Set-Cookie": sessionCookie(token, app.config.secureCookies) },
      );
    },
  },
  {
    // A link back in to every account with this address. The same answer whether one has it or not.
    method: "POST",
    path: "/api/auth/reset",
    handler: async ({ app, req }) => {
      const body = await readJson(
        req,
        z.strictObject({ email: emailSchema, language: z.string().max(10).optional() }),
      );
      await requestReset(app, body.email, body.language, clientIp(req));
      return json(202, { status: "sent" });
    },
  },
  {
    // Uses a link back in, once: a new password, shown here, and a session.
    method: "POST",
    path: "/api/auth/reset/use",
    handler: async ({ app, req }) => {
      // A string that is no token is simply not found, like a used one.
      const body = await readJson(req, z.strictObject({ token: z.string().max(100) }));
      const { account, password, session } = await useReset(app, body.token, clientIp(req));
      return json(
        200,
        { account: publicAccount(account), password: freshPassword(password) },
        { "Set-Cookie": sessionCookie(session, app.config.secureCookies) },
      );
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    handler: async ({ app, req }) => {
      // Read the cookie directly: loading the session could refresh it in the same response.
      const token = readSessionToken(req.headers.get("cookie"), app.config.secureCookies);
      if (token) {
        await app.store.deleteSession(sessionId(token));
        // Its live connections end with it; the account's other logins keep theirs.
        app.draftEvents.publish({ kind: "access" });
      }
      return json(204, null, { "Set-Cookie": clearSessionCookie(app.config.secureCookies) });
    },
  },
];
