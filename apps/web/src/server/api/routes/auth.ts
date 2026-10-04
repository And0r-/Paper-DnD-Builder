import { z } from "zod";
import {
  emailSchema,
  login,
  passwordInputSchema,
  publicAccount,
  requestPassword,
} from "../../auth/accounts.ts";
import { clearSessionCookie, readSessionToken, sessionCookie, sessionId } from "../../auth/session.ts";
import { clientIp, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";

export const authRoutes: Route[] = [
  {
    // Sign-up and "forgot password" are the same: a password is made and mailed.
    method: "POST",
    path: "/api/auth/password",
    handler: async ({ app, req }) => {
      const body = await readJson(
        req,
        z.object({ email: emailSchema, language: z.string().max(10).optional() }),
      );
      await requestPassword(app, body.email, body.language, clientIp(req));
      return json(202, { status: "sent" });
    },
  },
  {
    method: "POST",
    path: "/api/auth/login",
    handler: async ({ app, req }) => {
      const body = await readJson(req, z.object({ email: emailSchema, password: passwordInputSchema }));
      const { account, token } = await login(app, body.email, body.password, clientIp(req));
      return json(
        200,
        { account: publicAccount(account) },
        { "Set-Cookie": sessionCookie(token, app.config.secureCookies) },
      );
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    handler: async ({ app, req }) => {
      // Read the cookie directly: loading the session could refresh it in the same response.
      const token = readSessionToken(req.headers.get("cookie"), app.config.secureCookies);
      if (token) await app.store.deleteSession(sessionId(token));
      return json(204, null, { "Set-Cookie": clearSessionCookie(app.config.secureCookies) });
    },
  },
];
