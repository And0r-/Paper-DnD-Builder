/**
 * The live channel's WebSocket endpoint: `GET /api/live/drafts/{id}`
 * with `Upgrade: websocket`, on the same server and port as everything
 * else. Login as for the API: the session cookie (a browser sends it on
 * its own) or `Authorization: Bearer <key>`. Whoever is neither the
 * draft's owner nor the game master of its campaign adds the draft's help
 * link: `?help=<token>`.
 *
 * Why this is safe:
 * - A page of another site cannot open the channel with the player's
 *   cookie: the handshake must come from this site (`Origin`), else it is
 *   refused before anything is read.
 * - Who may reach the draft is decided here, on the server, with the same
 *   rule as the API (`findDraftFor`), when connecting and again before
 *   every change; a draft one may not reach is closed with 4404, exactly
 *   like a missing one. A help link withdrawn or replaced closes the
 *   helper's connection at once.
 * - Messages are at most 64 KiB, checked against a schema, limited per
 *   connection; at most MAX_PEOPLE_PER_DRAFT connections share a draft.
 * - Nothing is logged of what is sent.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { App } from "../app.ts";
import { loadSession } from "../api/router.ts";
import { findDraftFor } from "../api/routes/drafts.ts";
import { CLOSE, liveHub, type Authorize } from "./hub.ts";

const PATH = /^\/api\/live\/drafts\/([^/]+)\/?$/;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Proxies close quiet connections after a minute or so; a ping keeps them open and finds dead ones. */
const PING_MS = 30_000;

/** The standard Request the API's login check reads, from the handshake's headers. */
function asRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
  }
  return new Request(new URL(req.url ?? "/", "http://live.invalid"), { headers });
}

/**
 * Same site only. With BASE_URL set the origin must be exactly that one;
 * without, its host must be the host the handshake was sent to. A client
 * that sends no `Origin` is no browser, and brings no cookie of a player's.
 */
function sameSite(req: IncomingMessage, app: App): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (app.config.baseUrl) return origin === app.config.baseUrl.origin;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;

/**
 * Answers the upgrades of the live channel's path and returns true for
 * them; returns false for every other one, which stays whoever's it is
 * (Next.js' own in development).
 */
export function liveUpgradeHandler(getApp: () => Promise<App>): UpgradeHandler {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakSet<WebSocket>();
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_MS);
  ping.unref();

  return (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://live.invalid");
    const found = PATH.exec(url.pathname);
    if (!found) return false;
    socket.on("error", () => socket.destroy());
    void (async () => {
      let app: App;
      try {
        app = await getApp();
      } catch {
        return refuse(socket, 503, "Service Unavailable");
      }
      if (!sameSite(req, app)) return refuse(socket, 403, "Forbidden");
      let draftId: string;
      try {
        draftId = decodeURIComponent(found[1]!);
      } catch {
        return refuse(socket, 404, "Not Found");
      }
      const help = url.searchParams.get("help");
      const request = asRequest(req);
      const authorize: Authorize = async () => {
        const session = await loadSession(app, request, new Headers());
        if (!session)
          return { ok: false, code: request.headers.has("authorization") ? "keyNotValid" : "notLoggedIn" };
        const row = await findDraftFor(app, draftId, session.account.id, help);
        return row ? { ok: true, row, name: session.account.name } : { ok: false, code: "draftNotFound" };
      };
      wss.handleUpgrade(req, socket, head, (ws) => {
        alive.add(ws);
        ws.on("pong", () => alive.add(ws));
        // Messages that arrive while the login is checked wait for it.
        const early: string[] = [];
        let joined: ReturnType<ReturnType<typeof liveHub>["join"]> | null = null;
        let closed = false;
        ws.on("message", (data, binary) => {
          if (binary) return;
          const text = data.toString();
          if (joined) joined.receive(text);
          else if (joined === null && early.length < 20) early.push(text);
        });
        ws.on("close", () => {
          closed = true;
          joined?.leave();
        });
        void (async () => {
          try {
            const auth = await authorize();
            if (closed) return;
            if (!auth.ok) {
              ws.send(JSON.stringify({ type: "error", code: auth.code }));
              return ws.close(CLOSE[auth.code], auth.code);
            }
            joined = liveHub(app).join(auth.row, { name: auth.name }, ws, authorize);
            if (!joined) return;
            for (const text of early.splice(0)) joined.receive(text);
          } catch (error) {
            console.error("Live join failed:", error instanceof Error ? error.stack : error);
            ws.close(1011, "internal");
          }
        })();
      });
    })();
    return true;
  };
}
