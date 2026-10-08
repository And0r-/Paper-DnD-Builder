/**
 * The live channel: everyone who has a character open hears about every
 * stored change to it at once, whoever made it and however (browser, API,
 * MCP), and who else has it open right now.
 *
 * Server-Sent Events, not WebSocket. Next.js route handlers cannot take a
 * WebSocket upgrade; that would need a server of our own around Next.js or
 * patching Node's HTTP server, and the standalone build, the Docker image
 * and the browser-test server would no longer be what Next.js makes. Events
 * are plain streamed HTTP through the API router instead: one process, one
 * port, the same login (cookie or key) and the same access check as
 * reading the character. The other direction, a change, goes over the API
 * as always; nothing about how drafts change is touched here.
 *
 * The events are told where the server stores (`DraftEvents`), never
 * passed on from one client to another. They carry no character content:
 * a client fetches `GET /api/drafts/:id` (or the play state) when it sees
 * one. Who is connected is kept in memory per process, never stored.
 *
 * Access is checked when connecting and again on every heartbeat (30 s):
 * a session that ended, a withdrawn key or a game master who lost the
 * character is cut off by then at the latest. Logout, a withdrawn key, a
 * deleted account and a player leaving a campaign cut off at once.
 */
import type { ChangeSource, DraftEvent, DraftEvents } from "./app.ts";
import type { RequestContext, Session } from "./api/router.ts";
import type { ReachableDraftRow, Store } from "./store.ts";

/** How a change or a connection came in: the browser (cookie), a program with a key, or an MCP program with a key. */
export type Via = "browser" | "api" | "mcp";
export type Role = ReachableDraftRow["access"];

/** One person on a character right now. */
export interface Present {
  accountName: string;
  role: Role;
  via: Via;
  /** The browser window's own id, if it gave one: it finds itself in the list. */
  clientId: string | null;
}

export interface PresenceEvent {
  type: "presence";
  draftId: string;
  at: string;
  present: Present[];
}

/**
 * A program says what it is: `X-Builder-Client: mcp` from the MCP server
 * (in the web app and in the zip). A label for the screen, not a proof;
 * whoever has the key could send anything here, and only gets their own
 * change labelled otherwise.
 */
export const CLIENT_HEADER = "x-builder-client";
/** A browser window's own id on its changes, so it knows them when they come back. */
export const CLIENT_ID_HEADER = "x-builder-client-id";
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function viaOf(session: Session, headers: Headers): Via {
  if (session.via === "cookie") return "browser";
  return headers.get(CLIENT_HEADER)?.trim().toLowerCase() === "mcp" ? "mcp" : "api";
}

/** A window id as given, or null for none or one that is not a short plain token. */
export function clientIdOf(value: string | null): string | null {
  return value !== null && CLIENT_ID.test(value) ? value : null;
}

/** Tells everyone on the character what the request just stored. */
export async function tell(
  ctx: RequestContext,
  draft: { id: string; version: number },
  role: Role,
  what: Pick<DraftEvent, "type" | "change">,
): Promise<void> {
  const session = await ctx.requireSession();
  const source: ChangeSource = {
    via: viaOf(session, ctx.req.headers),
    accountId: session.account.id,
    accountName: session.account.name,
    role,
    clientId: clientIdOf(ctx.req.headers.get(CLIENT_ID_HEADER)),
  };
  ctx.app.draftEvents.publish({
    type: what.type,
    draftId: draft.id,
    version: draft.version,
    at: ctx.app.now().toISOString(),
    source,
    ...(what.change ? { change: what.change } : {}),
  });
}

export const HEARTBEAT_MS = 30_000;
export const MAX_CONNECTIONS_PER_ACCOUNT = 5;

interface Connection {
  draftId: string;
  accountId: string;
  present: Present;
  /** What logged the connection in: checked again on every heartbeat. */
  login: { via: "cookie" | "key"; id: string };
  write(text: string): void;
  end(): void;
}

export interface Subscriber {
  draftId: string;
  accountId: string;
  present: Present;
  login: Connection["login"];
  /** Ends with the request: the client went away. */
  signal: AbortSignal;
}

const encoder = new TextEncoder();
const frame = (event: DraftEvent | PresenceEvent) => `data: ${JSON.stringify(event)}\n\n`;

export class LiveChannel {
  private readonly connections = new Set<Connection>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly store: Store;
  private readonly now: () => Date;
  private readonly heartbeatMs: number;

  constructor(deps: { store: Store; now: () => Date; events: DraftEvents; heartbeatMs?: number }) {
    this.store = deps.store;
    this.now = deps.now;
    this.heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
    deps.events.subscribe((e) => this.deliver(e));
  }

  /** Open connections of an account, on any character. */
  count(accountId: string): number {
    let n = 0;
    for (const c of this.connections) if (c.accountId === accountId) n++;
    return n;
  }

  /** Who is on a character now. */
  present(draftId: string): Present[] {
    return [...this.connections].filter((c) => c.draftId === draftId).map((c) => c.present);
  }

  /** The event stream for one subscriber; it stays open until the client or the server ends it. */
  open(s: Subscriber): Response {
    let conn: Connection | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let open = true;
        conn = {
          draftId: s.draftId,
          accountId: s.accountId,
          present: s.present,
          login: s.login,
          write: (text) => {
            if (open) controller.enqueue(encoder.encode(text));
          },
          end: () => {
            if (!open) return;
            open = false;
            try {
              controller.close();
            } catch {
              // Already cancelled by the client.
            }
          },
        };
        // A client that loses the line tries again after 5 s (EventSource does so by itself).
        conn.write("retry: 5000\n\n");
        this.connections.add(conn);
        this.startHeartbeat();
        this.announce(s.draftId);
      },
      cancel: () => {
        if (conn) this.drop(conn);
      },
    });
    s.signal.addEventListener("abort", () => conn && this.drop(conn), { once: true });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        // no-transform: no compression, which would hold events back in a buffer.
        "Cache-Control": "no-store, no-transform",
        // nginx and others: pass every event on at once.
        "X-Accel-Buffering": "no",
      },
    });
  }

  /** Ends the connections that match, e.g. those of a session that logged out. */
  close(match: (c: { accountId: string; draftId: string; login: Connection["login"] }) => boolean): void {
    for (const c of [...this.connections]) if (match(c)) this.drop(c);
  }

  /**
   * Checks the matching connections again, as on connecting: the login
   * still valid, the character still reachable. Those that fail are ended.
   */
  async recheck(match: (c: { role: Role; draftId: string }) => boolean = () => true): Promise<void> {
    const now = this.now();
    await Promise.all(
      [...this.connections]
        .filter((c) => match({ role: c.present.role, draftId: c.draftId }))
        .map(async (c) => {
          try {
            const accountId = await this.store.loginAccount(c.login.via, c.login.id, now);
            const ok =
              accountId === c.accountId &&
              (await this.store.findReachableDraft(c.draftId, c.accountId)) !== undefined;
            if (!ok) this.drop(c);
          } catch (error) {
            // The database is away for a moment: keep the connection, check on the next beat.
            console.error("Live check failed:", (error as Error).message);
          }
        }),
    );
  }

  /** Ends every connection (server shutdown, tests). */
  stop(): void {
    this.close(() => true);
  }

  private deliver(e: DraftEvent): void {
    const text = frame(e);
    for (const c of this.connections) if (c.draftId === e.draftId) c.write(text);
    if (e.type === "deleted") this.close((c) => c.draftId === e.draftId);
    // Moved out of a campaign: its game master no longer reaches it.
    if (e.type === "campaign") void this.recheck((c) => c.draftId === e.draftId && c.role === "gameMaster");
  }

  private drop(c: Connection): void {
    if (!this.connections.delete(c)) return;
    c.end();
    this.announce(c.draftId);
    if (this.connections.size === 0) this.stopHeartbeat();
  }

  /** Tells everyone on the character who is on it now. */
  private announce(draftId: string): void {
    const text = frame({
      type: "presence",
      draftId,
      at: this.now().toISOString(),
      present: this.present(draftId),
    });
    for (const c of this.connections) if (c.draftId === draftId) c.write(text);
  }

  private startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.beat(), this.heartbeatMs);
    // The heartbeat alone does not keep the process running.
    this.timer.unref?.();
  }

  private stopHeartbeat(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** A comment line keeps proxies from closing a quiet connection; then the access check. */
  async beat(): Promise<void> {
    for (const c of this.connections) c.write(": ping\n\n");
    await this.recheck();
  }
}
