/**
 * The live channel: several people on one character at once. Everyone on
 * it sees who else is there (and how: browser, program, MCP), on which step
 * and pointing at what, and hears of every stored change the moment it is
 * made, whoever made it and however: over this channel, the HTTP API with
 * a cookie or a key, or the MCP server. A change of the draft comes with
 * its new state; anyone on it may answer.
 *
 * Nothing here keeps a draft: the draft is stored as always, and every
 * change goes through `commitChange`, the same function the HTTP routes
 * use, with the same checks. The hub only keeps who is connected, in
 * memory; a lost connection loses nothing but its place in the list.
 *
 * Transport-neutral: a connection is anything with `send` and `close`
 * (a WebSocket in upgrade.ts, a fake in tests).
 */
import { RuleError } from "@builder/core";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { App, ChangeSource, DraftEvent, Via } from "../app.ts";
import { HttpError } from "../api/http.ts";
import {
  changeBodies,
  commitChange,
  draftView,
  edits,
  packageKeyOf,
  type Edit,
} from "../api/routes/drafts.ts";
import type { Limit } from "../auth/rate-limit.ts";
import type { ReachableDraftRow } from "../store.ts";

export interface LiveSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
}

export type Role = ReachableDraftRow["access"];

/**
 * Asks again whether this connection may still reach the draft (session
 * or key still valid, and still the owner, the game master or holding a
 * working help link). Asked before every change and whenever who may
 * reach drafts changes.
 */
export type Authorize = () => Promise<
  | { ok: true; row: ReachableDraftRow; accountId: string; name: string; login: "cookie" | "key" }
  | { ok: false; code: "notLoggedIn" | "keyNotValid" | "draftNotFound" }
>;

/** Close codes: 4000 + the HTTP status the same refusal has in the API. */
export const CLOSE = {
  notLoggedIn: 4401,
  keyNotValid: 4401,
  draftNotFound: 4404,
  tooManyPeople: 4429,
} as const;

/** More than a table of players and their game master; a loop opening connections stops here. */
export const MAX_PEOPLE_PER_DRAFT = 20;
/** How often everyone's access is checked again, so an ended session or a lost role ends the connection. */
export const RECHECK_MS = 30_000;
/** Clicking quickly through a list stays far below this; a script sending in a loop does not. */
export const LIVE_MESSAGES: Limit = { max: 60, windowMs: 10_000 };

const short = z.string().min(1).max(200);
const ref = z.string().min(1).max(100).optional();

/** Everything a connection may send. The changes carry the same fields as the HTTP routes' bodies. */
export const clientMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("step"), step: short.nullable() }),
  z.strictObject({ type: z.literal("point"), target: short.nullable() }),
  z.strictObject({ type: z.literal("hint"), text: z.string().trim().min(1).max(500) }),
  changeBodies.answer.extend({ type: z.literal("answer"), ref, choice: short }),
  changeBodies.pool.extend({ type: z.literal("pool"), ref, step: short }),
  changeBodies.tracks.extend({ type: z.literal("tracks"), ref }),
  changeBodies.setLevel.extend({ type: z.literal("setLevel"), ref }),
  changeBodies.levelUp.extend({ type: z.literal("levelUp"), ref }),
  changeBodies.finish.extend({ type: z.literal("finish"), ref }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;
type ChangeMessage = Extract<ClientMessage, { version: number }>;

function editOf(m: ChangeMessage): Edit {
  switch (m.type) {
    case "answer":
      return edits.answer(m.choice, m.answer);
    case "pool":
      return edits.pool(m.step, m.picks);
    case "tracks":
      return edits.tracks(m.tracks);
    case "setLevel":
      return edits.setLevel(m.level);
    case "levelUp":
      return edits.levelUp(m.level, m.tracks);
    case "finish":
      return edits.finish();
  }
}

interface Member {
  /** This connection's id: one person may be there twice (two tabs). */
  id: string;
  name: string;
  role: Role;
  via: Via;
  /** The browser window's own id (`?clientId=`), the same it sends on its HTTP changes. */
  clientId: string | null;
  step: string | null;
  point: string | null;
  socket: LiveSocket;
  authorize: Authorize;
  /** Messages of one connection are handled one after the other, in order. */
  queue: Promise<void>;
  gone: boolean;
}

interface Room {
  draftId: string;
  ownerName: string;
  /** The highest draft version sent to this room; older news is dropped. */
  version: number;
  members: Map<string, Member>;
}

export interface Joined {
  id: string;
  /** Hand every text frame of the connection here. */
  receive(text: string): void;
  /** Call when the connection closed, however. */
  leave(): void;
}

/** Who is on a character, as everyone on it sees them. No account id: a name and a role are enough. */
const publicPerson = (m: Member) => ({
  id: m.id,
  name: m.name,
  role: m.role,
  via: m.via,
  clientId: m.clientId,
  step: m.step,
  point: m.point,
});

/** Who made a change, as everyone on the character sees it. */
const publicSource = (s: ChangeSource) => ({
  via: s.via,
  name: s.accountName,
  role: s.role,
  clientId: s.clientId,
  connectionId: s.connectionId ?? null,
});

export class LiveHub {
  private readonly app: App;
  private readonly rooms = new Map<string, Room>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(app: App) {
    this.app = app;
    app.draftEvents.subscribe((e) => this.onEvent(e));
  }

  /** How many are on a draft now; for tests and the log. */
  count(draftId: string): number {
    return this.rooms.get(draftId)?.members.size ?? 0;
  }

  /**
   * Puts an authorised connection on the draft `row`: it gets `welcome`,
   * then the draft's `state`; everyone gets the new `presence`.
   */
  join(
    row: ReachableDraftRow,
    who: { name: string; via: Via; clientId: string | null },
    socket: LiveSocket,
    authorize: Authorize,
  ): Joined | undefined {
    let room = this.rooms.get(row.id);
    if (!room) {
      room = { draftId: row.id, ownerName: row.owner_name, version: row.version, members: new Map() };
      this.rooms.set(row.id, room);
      this.startRecheck();
    }
    if (room.members.size >= MAX_PEOPLE_PER_DRAFT) {
      send(socket, { type: "error", code: "tooManyPeople", max: MAX_PEOPLE_PER_DRAFT });
      socket.close(CLOSE.tooManyPeople, "tooManyPeople");
      if (room.members.size === 0) this.removeRoom(row.id);
      return undefined;
    }
    room.version = Math.max(room.version, row.version);
    const member: Member = {
      id: randomBytes(9).toString("base64url"),
      name: who.name,
      role: row.access,
      via: who.via,
      clientId: who.clientId,
      step: null,
      point: null,
      socket,
      authorize,
      queue: Promise.resolve(),
      gone: false,
    };
    room.members.set(member.id, member);
    send(socket, { type: "welcome", draftId: row.id, you: publicPerson(member) });
    this.presence(room);
    send(socket, this.state(row, member, { by: null }));
    const r = room;
    return {
      id: member.id,
      receive: (text) => {
        member.queue = member.queue.then(() => this.receive(r, member, text));
      },
      leave: () => this.leave(r, member),
    };
  }

  private leave(room: Room, member: Member): void {
    if (member.gone) return;
    member.gone = true;
    room.members.delete(member.id);
    if (room.members.size === 0) this.removeRoom(room.draftId);
    else this.presence(room);
  }

  private kick(room: Room, member: Member, code: keyof typeof CLOSE): void {
    send(member.socket, { type: "error", code });
    member.socket.close(CLOSE[code], code);
    this.leave(room, member);
  }

  private async receive(room: Room, member: Member, text: string): Promise<void> {
    if (member.gone) return;
    if (!this.app.limiter.take(`live:${member.id}`, LIVE_MESSAGES).ok) {
      send(member.socket, { type: "error", code: "tooManyRequests" });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      send(member.socket, { type: "error", code: "badJson" });
      return;
    }
    const parsed = clientMessage.safeParse(raw);
    if (!parsed.success) {
      const r = (raw as { ref?: unknown } | null)?.ref;
      send(member.socket, {
        type: "error",
        code: "badRequest",
        ...(typeof r === "string" && r.length <= 100 ? { ref: r } : {}),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    const m = parsed.data;
    switch (m.type) {
      case "step":
        member.step = m.step;
        this.presence(room);
        return;
      case "point":
        member.point = m.target;
        this.presence(room);
        return;
      case "hint":
        this.broadcast(room, () => ({
          type: "hint",
          draftId: room.draftId,
          from: { id: member.id, name: member.name },
          text: m.text,
        }));
        return;
      default:
        return this.change(room, member, m);
    }
  }

  private async change(room: Room, member: Member, m: ChangeMessage): Promise<void> {
    const withRef = m.ref === undefined ? {} : { ref: m.ref };
    try {
      const auth = await member.authorize();
      if (!auth.ok) return this.kick(room, member, auth.code);
      const done = await commitChange(
        this.app,
        auth.row,
        m.version,
        editOf(m),
        async () => {
          const again = await member.authorize();
          return again.ok ? again.row : undefined;
        },
        {
          via: member.via,
          accountId: auth.accountId,
          accountName: auth.name,
          role: auth.row.access,
          clientId: member.clientId,
          connectionId: member.id,
          ref: m.ref,
        },
      );
      // The server is the truth: an old version gets the state now, not an error.
      if (!done.ok)
        send(member.socket, this.state(done.current, member, { by: null, ...withRef, stale: true }));
      // Done: the draft event sends the new state to everyone, this connection with its `ref`.
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.code === "draftNotFound") return this.kick(room, member, "draftNotFound");
        send(member.socket, { type: "error", code: error.code, ...withRef, ...error.details });
      } else if (error instanceof RuleError) {
        console.error(`Rule error: ${error.message}`);
        send(member.socket, { type: "error", code: "packageRuleError", ...withRef, message: error.message });
      } else {
        console.error("Live change failed:", error instanceof Error ? error.stack : error);
        send(member.socket, { type: "error", code: "internal", ...withRef });
      }
    }
  }

  private onEvent(e: DraftEvent): void {
    if (e.kind === "access") {
      const rooms = e.draftId ? [this.rooms.get(e.draftId)] : [...this.rooms.values()];
      for (const room of rooms) if (room) void this.recheck(room);
      return;
    }
    const room = this.rooms.get(e.draftId);
    if (!room) return;
    const at = this.app.now().toISOString();
    const source = publicSource(e.source);
    const mine = (m: Member) =>
      e.source.connectionId === m.id && e.source.ref !== undefined ? { ref: e.source.ref } : {};
    if (e.kind === "character") {
      const message = {
        // `state` is the draft's own message here: the play state is `playState`.
        type: e.type === "state" ? "playState" : e.type,
        draftId: e.draftId,
        version: room.version,
        at,
        source,
        ...(e.change ? { change: e.change } : {}),
      };
      this.broadcast(room, () => message);
      if (e.type === "deleted")
        for (const m of [...room.members.values()]) this.kick(room, m, "draftNotFound");
      // Moved out of a campaign: its game master no longer reaches it.
      if (e.type === "campaign") void this.recheck(room);
      return;
    }
    if (e.version <= room.version) return;
    room.version = e.version;
    const by = e.source.connectionId ? room.members.get(e.source.connectionId) : undefined;
    const cause = { event: e.type, at, source, ...(e.change ? { change: e.change } : {}) };
    for (const m of room.members.values()) {
      const row = { ...e.row, owner_name: room.ownerName, access: m.role };
      const extra = { by: by ? { id: by.id, name: by.name } : null, ...cause, ...mine(m) };
      send(m.socket, this.state(row, m, extra, e.raisedFrom));
    }
  }

  /** Whoever may no longer reach the draft leaves it. */
  private async recheck(room: Room): Promise<void> {
    for (const m of [...room.members.values()]) {
      try {
        const auth = await m.authorize();
        if (!auth.ok && !m.gone) this.kick(room, m, auth.code);
      } catch (error) {
        console.error("Live access check failed:", (error as Error).message);
      }
    }
  }

  /** The draft as `m` sees it, with what the message adds (who changed it and how, `ref`, `stale`). */
  private state(row: ReachableDraftRow, m: Member, extra: object, raisedFrom?: number) {
    const view = draftView({ ...row, access: m.role }, this.app.packages.get(packageKeyOf(row)), raisedFrom);
    return { type: "state", draftId: row.id, version: row.version, ...extra, ...view };
  }

  private presence(room: Room): void {
    const people = [...room.members.values()].map(publicPerson);
    this.broadcast(room, () => ({ type: "presence", draftId: room.draftId, people }));
  }

  private removeRoom(draftId: string): void {
    this.rooms.delete(draftId);
    if (this.rooms.size === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** While anyone is on a character: everyone's access again, now and then (a session may run out). */
  private startRecheck(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const room of this.rooms.values()) void this.recheck(room);
    }, RECHECK_MS);
    // The check alone does not keep the process running.
    this.timer.unref?.();
  }

  private broadcast(room: Room, message: () => unknown): void {
    const text = JSON.stringify(message());
    for (const m of room.members.values()) sendText(m.socket, text);
  }
}

function send(socket: LiveSocket, message: unknown): void {
  sendText(socket, JSON.stringify(message));
}

function sendText(socket: LiveSocket, text: string): void {
  try {
    socket.send(text);
  } catch {
    // A connection closing as we send: its close handler takes it off the draft.
  }
}

const hubs = new WeakMap<App, LiveHub>();

/** The one hub of an app. */
export function liveHub(app: App): LiveHub {
  let hub = hubs.get(app);
  if (!hub) hubs.set(app, (hub = new LiveHub(app)));
  return hub;
}
