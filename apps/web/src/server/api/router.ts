/**
 * The API: one table of routes on standard Request/Response.
 *
 * Next.js passes every /api request here (app/api/[...path]/route.ts).
 * Keeping the API free of Next.js specifics means tests call it directly,
 * and the coming WebSocket channel can reuse the same functions.
 */
import { RuleError } from "@builder/core";
import type { App } from "../app.ts";
import { accessKeyHash, readBearerKey } from "../auth/access-keys.ts";
import {
  SESSION_MS,
  SESSION_REFRESH_MS,
  readSessionToken,
  sessionCookie,
  sessionId,
} from "../auth/session.ts";
import type { AccountRow } from "../store.ts";
import { accountRoutes } from "./routes/account.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { campaignRoutes } from "./routes/campaigns.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { feedbackRoutes } from "./routes/feedback.ts";
import { helpLinkRoutes } from "./routes/help-links.ts";
import { packageRoutes } from "./routes/packages.ts";
import { printRoutes } from "./routes/print.ts";
import { sheetCopyRoutes } from "./routes/sheet-copies.ts";
import { assertSameOrigin, errorResponse, HttpError, json } from "./http.ts";

export interface Session {
  /** The session id (cookie) or the access key id (key). */
  id: string;
  /** How the request logged in: the browser's session cookie or an access key. */
  via: "cookie" | "key";
  account: AccountRow;
}

export interface RequestContext {
  app: App;
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Headers added to whatever the handler returns (e.g. a refreshed session cookie). */
  responseHeaders: Headers;
  /** The logged-in account, or undefined. */
  session(): Promise<Session | undefined>;
  /** The logged-in account; answers 401 if there is none. */
  requireSession(): Promise<Session>;
  /**
   * The logged-in admin, in the browser: 401 without a login, 403 for a
   * player, and 403 for an access key, an admin's too. A key is made for a
   * program and can leak with it; looking after other people's accounts
   * stays with the person at the browser.
   */
  requireAdmin(): Promise<Session>;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handler: (ctx: RequestContext) => Promise<Response>;
}

export const ROUTES: Route[] = [
  ...authRoutes,
  ...accountRoutes,
  ...packageRoutes,
  ...draftRoutes,
  ...helpLinkRoutes,
  ...printRoutes,
  ...sheetCopyRoutes,
  ...campaignRoutes,
  ...adminRoutes,
  ...feedbackRoutes,
];

function match(pattern: string, path: string): Record<string, string> | undefined {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) {
      let value: string;
      try {
        value = decodeURIComponent(s[i]!);
      } catch {
        return undefined;
      }
      if (value === "") return undefined;
      params[p[i]!.slice(1)] = value;
    } else if (p[i] !== s[i]) return undefined;
  }
  return params;
}

export function createApiHandler(app: App, routes: Route[] = ROUTES): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    let params: Record<string, string> | undefined;
    const route = routes.find((r) => r.method === req.method && (params = match(r.path, path)));
    if (!route || !params) {
      const exists = routes.some((r) => match(r.path, path));
      return errorResponse(exists ? new HttpError(405, "methodNotAllowed") : new HttpError(404, "notFound"));
    }

    const responseHeaders = new Headers();
    let cached: Promise<Session | undefined> | undefined;
    const ctx: RequestContext = {
      app,
      req,
      url,
      params,
      responseHeaders,
      session: () => (cached ??= loadSession(app, req, responseHeaders)),
      requireSession: async () => {
        const s = await ctx.session();
        if (s) return s;
        // A key that is wrong or withdrawn says so: a tool should not ask for a login.
        if (req.headers.has("authorization")) throw new HttpError(401, "keyNotValid");
        throw new HttpError(401, "notLoggedIn");
      },
      requireAdmin: async () => {
        const s = await ctx.requireSession();
        if (s.via !== "cookie") throw new HttpError(403, "keyCannotAdmin");
        if (s.account.role !== "admin") throw new HttpError(403, "adminOnly");
        return s;
      },
    };

    let res: Response;
    try {
      assertSameOrigin(req, app.config.baseUrl?.origin ?? url.origin);
      res = await route.handler(ctx);
    } catch (error) {
      if (error instanceof HttpError) res = errorResponse(error);
      else if (error instanceof RuleError) {
        // The package's rules could not be evaluated: a package bug, reported as such.
        console.error(`Rule error: ${error.message}`);
        res = json(500, { error: { code: "packageRuleError", message: error.message } });
      } else {
        // Never log request bodies: they can hold passwords.
        console.error(`API ${req.method} ${path} failed:`, error instanceof Error ? error.stack : error);
        res = json(500, { error: { code: "internal" } });
      }
    }
    responseHeaders.forEach((value, key) => res.headers.append(key, value));
    return res;
  };
}

/**
 * Who is asking. A request with an `Authorization` header is judged by its
 * access key alone, never by a cookie it may also carry: a tool gets exactly
 * the account its key belongs to.
 */
export async function loadSession(app: App, req: Request, out: Headers): Promise<Session | undefined> {
  const key = readBearerKey(req.headers.get("authorization"));
  if (key !== undefined) {
    const found = key === null ? undefined : await app.store.findAccountByKey(accessKeyHash(key), app.now());
    return found && { id: found.key_id, via: "key", account: found.account };
  }
  const secure = app.config.secureCookies;
  const token = readSessionToken(req.headers.get("cookie"), secure);
  if (!token) return undefined;
  const id = sessionId(token);
  const now = app.now();
  const found = await app.store.findSession(id, now);
  if (!found) return undefined;
  // Counted for the admin's "active now", in memory only; access keys are programs, not people.
  app.presence.touch(id);
  // Sliding expiry: a session in use stays alive; refreshed at most once a day.
  if (now.getTime() - found.refreshed_at.getTime() > SESSION_REFRESH_MS) {
    await app.store.refreshSession(id, new Date(now.getTime() + SESSION_MS), now);
    out.append("Set-Cookie", sessionCookie(token, secure));
  }
  return { id, via: "cookie", account: found.account };
}
