/**
 * The API: one table of routes on standard Request/Response.
 *
 * Next.js passes every /api request here (app/api/[...path]/route.ts).
 * Keeping the API free of Next.js specifics means tests call it directly,
 * and the coming WebSocket channel can reuse the same functions.
 */
import { RuleError } from "@builder/core";
import type { App } from "../app.ts";
import {
  SESSION_MS,
  SESSION_REFRESH_MS,
  readSessionToken,
  sessionCookie,
  sessionId,
} from "../auth/session.ts";
import type { AccountRow } from "../store.ts";
import { accountRoutes } from "./routes/account.ts";
import { authRoutes } from "./routes/auth.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { packageRoutes } from "./routes/packages.ts";
import { assertSameOrigin, errorResponse, HttpError, json } from "./http.ts";

export interface Session {
  id: string;
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
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handler: (ctx: RequestContext) => Promise<Response>;
}

export const ROUTES: Route[] = [...authRoutes, ...accountRoutes, ...packageRoutes, ...draftRoutes];

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
        if (!s) throw new HttpError(401, "notLoggedIn");
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

async function loadSession(app: App, req: Request, out: Headers): Promise<Session | undefined> {
  const secure = app.config.secureCookies;
  const token = readSessionToken(req.headers.get("cookie"), secure);
  if (!token) return undefined;
  const id = sessionId(token);
  const now = app.now();
  const found = await app.store.findSession(id, now);
  if (!found) return undefined;
  // Sliding expiry: a session in use stays alive; refreshed at most once a day.
  if (now.getTime() - found.refreshed_at.getTime() > SESSION_REFRESH_MS) {
    await app.store.refreshSession(id, new Date(now.getTime() + SESSION_MS), now);
    out.append("Set-Cookie", sessionCookie(token, secure));
  }
  return { id, account: found.account };
}
