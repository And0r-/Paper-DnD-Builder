/**
 * The live help over real WebSockets: the owner, the game master of the
 * draft's campaign, a helper with the help link and a stranger. One
 * changes the draft, the others see the new state; who may not reach the
 * draft gets 4404 as for a missing one; a lost connection comes back with
 * the same link; a link withdrawn or past its end opens nothing.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createMcpRoute } from "../mcp-route.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";
import { liveUpgradeHandler } from "./upgrade.ts";

let server: TestServer;
let http: Server;
let base: string;
let owner: Client;
let gm: Client;
let stranger: Client;
let draftId: string;
let ownerPassword: string;
const open: Live[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- messages are checked field by field
type Message = any;

/** A WebSocket client that keeps every message and waits for the next one of a type. */
class Live {
  readonly ws: WebSocket;
  readonly messages: Message[] = [];
  private seen = 0;
  private waiters: (() => void)[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
    this.closed = new Promise((resolve) =>
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** The next message of `type` after the last one taken. */
  async next(type: string): Promise<Message> {
    for (;;) {
      const i = this.messages.findIndex((m, k) => k >= this.seen && m.type === type);
      if (i >= 0) {
        this.seen = i + 1;
        return this.messages[i];
      }
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no ${type} message`)), 3000);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
}

function connect(c: Client | null, draft: string, query = "", headers: Record<string, string> = {}): Live {
  // The app's public address (BASE_URL in the test server), as a browser on it sends it.
  const h: Record<string, string> = { origin: "http://builder.test", ...headers };
  if (c?.cookieHeader) h["cookie"] = c.cookieHeader;
  const live = new Live(
    new WebSocket(`${base.replace("http", "ws")}/api/live/drafts/${draft}${query}`, { headers: h }),
  );
  open.push(live);
  return live;
}

/** Connects and waits for the join: welcome, presence and the draft's state. */
async function joinLive(c: Client, draft = draftId, query = "") {
  const live = connect(c, draft, query);
  const welcome = await live.next("welcome");
  const state = await live.next("state");
  return { live, welcome, state };
}

async function helpLink(): Promise<string> {
  const res = await owner.call("POST", `/api/drafts/${draftId}/help-link`);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.helpLink.token;
}

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server, "203.0.113.1");
  gm = new Client(server, "203.0.113.2");
  stranger = new Client(server, "203.0.113.3");
  ownerPassword = await signIn(owner, "owner@example.org");
  await signIn(gm, "lead@example.org");
  await signIn(stranger, "helper@example.org");

  // The owner plays in the game master's campaign; the character belongs to it.
  const campaign = (await gm.call("POST", "/api/campaigns", { name: "Die Nebelrunde" })).json.campaign;
  await owner.call("POST", `/api/invites/${campaign.inviteUrl.split("/join/")[1]}/join`);
  const draft = await owner.call("POST", "/api/drafts", { packageId: "demo", campaignId: campaign.id });
  draftId = draft.json.draft.id;

  const handle = liveUpgradeHandler(async () => server.app);
  http = createServer((_req, res) => res.writeHead(404).end());
  http.on("upgrade", (req, socket, head) => {
    if (!handle(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const l of open.splice(0)) if (l.ws.readyState !== WebSocket.CONNECTING) l.ws.terminate();
  await new Promise((resolve) => http.close(resolve));
});

describe("live help", () => {
  it("shows an answer given on one connection on the other at once, with the evaluation", async () => {
    const a = await joinLive(owner);
    const b = await joinLive(gm);
    expect(a.welcome.you).toMatchObject({ name: "owner", role: "owner", via: "browser" });
    expect(b.welcome.you).toMatchObject({ name: "lead", role: "gameMaster", via: "browser" });
    expect(b.state.draft).toMatchObject({ id: draftId, version: 1, access: "gameMaster" });
    expect(b.state.evaluation).not.toBeNull();

    a.live.send({ type: "answer", ref: "r1", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    const seen = await b.live.next("state");
    expect(seen.draft).toMatchObject({ version: 2, answers: { folk: { pick: "folk.hillfolk" } } });
    expect(seen).toMatchObject({
      draftId,
      version: 2,
      event: "changed",
      change: { kind: "answer", choice: "folk" },
    });
    expect(seen.by).toEqual({ id: a.welcome.you.id, name: "owner" });
    expect(seen.source).toEqual({
      via: "browser",
      name: "owner",
      role: "owner",
      clientId: null,
      connectionId: a.welcome.you.id,
    });
    expect(seen.ref).toBeUndefined();
    expect(seen.evaluation).toEqual((await owner.call("GET", `/api/drafts/${draftId}`)).json.evaluation);
    // The one who answered gets the same state, with their `ref`.
    const mine = await a.live.next("state");
    expect(mine).toMatchObject({ ref: "r1", draft: { version: 2, access: "owner" } });

    // And the game master answers too.
    b.live.send({ type: "answer", version: 2, choice: "folk", answer: { pick: "folk.coastfolk" } });
    expect((await a.live.next("state")).draft.answers.folk).toEqual({ pick: "folk.coastfolk" });
  });

  it("passes on changes made over the HTTP API", async () => {
    const a = await joinLive(gm);
    await owner.call("PUT", `/api/drafts/${draftId}/answers/folk`, {
      version: 1,
      answer: { pick: "folk.hillfolk" },
    });
    const seen = await a.live.next("state");
    expect(seen).toMatchObject({
      by: null,
      source: { via: "browser", name: "owner", role: "owner", connectionId: null },
      draft: { version: 2 },
    });
  });

  it("answers an old version with the state now, not an error", async () => {
    const a = await joinLive(owner);
    const b = await joinLive(gm);
    a.live.send({ type: "answer", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    await b.live.next("state");
    b.live.send({
      type: "answer",
      ref: "late",
      version: 1,
      choice: "folk",
      answer: { pick: "folk.coastfolk" },
    });
    const back = await b.live.next("state");
    expect(back).toMatchObject({
      ref: "late",
      stale: true,
      draft: { version: 2, answers: { folk: { pick: "folk.hillfolk" } } },
    });
    expect(b.live.messages.some((m) => m.type === "error")).toBe(false);
  });

  it("refuses a change the rules refuse, to the sender only", async () => {
    const a = await joinLive(owner);
    a.live.send({ type: "answer", ref: "x", version: 1, choice: "folk", answer: { pick: "no.such.thing" } });
    expect(await a.live.next("error")).toMatchObject({ code: "changeRejected", ref: "x" });
    a.live.send({ type: "dance" });
    expect(await a.live.next("error")).toMatchObject({ code: "badRequest" });
    a.live.ws.send("{nope");
    expect(await a.live.next("error")).toMatchObject({ code: "badJson" });
  });

  it("shows who is there, on which step and pointing at what, and passes on hints", async () => {
    const a = await joinLive(owner);
    const b = await joinLive(gm);
    const both = await a.live.next("presence");
    expect(both.people.map((p: Message) => p.name)).toEqual(["owner", "lead"]);
    a.live.send({ type: "step", step: "folk" });
    b.live.send({ type: "point", target: "folk.hillfolk" });
    b.live.send({ type: "hint", text: "Schau dir den Schritt Zauber an" });
    expect(await a.live.next("hint")).toEqual({
      type: "hint",
      draftId,
      from: { id: b.welcome.you.id, name: "lead" },
      text: "Schau dir den Schritt Zauber an",
    });
    await expect
      .poll(() => b.live.messages.filter((m) => m.type === "presence").at(-1)?.people)
      .toEqual([
        {
          id: a.welcome.you.id,
          name: "owner",
          role: "owner",
          via: "browser",
          clientId: null,
          step: "folk",
          point: null,
        },
        {
          id: b.welcome.you.id,
          name: "lead",
          role: "gameMaster",
          via: "browser",
          clientId: null,
          step: null,
          point: "folk.hillfolk",
        },
      ]);

    b.live.ws.close();
    await expect
      .poll(() => a.live.messages.filter((m) => m.type === "presence").at(-1)?.people.length)
      .toBe(1);
  });

  it("closes with 4404 for a stranger and 4401 without a login, like the API's 404 and 401", async () => {
    const s = connect(stranger, draftId);
    expect(await s.next("error")).toEqual({ type: "error", code: "draftNotFound" });
    expect(await s.closed).toEqual({ code: 4404, reason: "draftNotFound" });
    // A draft that does not exist looks the same.
    expect((await connect(stranger, "00000000-0000-4000-8000-000000000000").closed).code).toBe(4404);
    expect((await connect(null, draftId).closed).code).toBe(4401);
    expect((await connect(null, draftId, "", { authorization: "Bearer nope" }).closed).reason).toBe(
      "keyNotValid",
    );
  });

  it("refuses a handshake from another site", async () => {
    const live = connect(owner, draftId, "", { origin: "https://evil.example" });
    const status = await new Promise((resolve) =>
      live.ws.on("unexpected-response", (_req, res) => resolve(res.statusCode)),
    );
    expect(status).toBe(403);
  });

  it("lets a helper in with the help link, and out again when it is withdrawn", async () => {
    const token = await helpLink();
    // Without the link: nothing.
    expect((await connect(stranger, draftId).closed).code).toBe(4404);
    const a = await joinLive(owner);
    const h = await joinLive(stranger, draftId, `?help=${token}`);
    expect(h.welcome.you.role).toBe("helper");
    expect(h.state.draft).toMatchObject({ access: "helper", owner: { name: "owner" } });

    h.live.send({ type: "answer", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    expect((await a.live.next("state")).source).toMatchObject({ name: "helper", role: "helper" });
    // The draft stays the owner's.
    expect((await owner.call("GET", "/api/drafts")).json.drafts[0]).toMatchObject({
      id: draftId,
      version: 2,
    });

    // The owner withdraws the link: the helper is out at once, the owner stays.
    expect((await owner.call("DELETE", `/api/drafts/${draftId}/help-link`)).status).toBe(204);
    expect(await h.live.closed).toEqual({ code: 4404, reason: "draftNotFound" });
    expect((await connect(stranger, draftId, `?help=${token}`).closed).code).toBe(4404);
    a.live.send({ type: "step", step: "folk" });
    await a.live.next("presence");
  });

  it("ends a link that was replaced or ran out", async () => {
    const first = await helpLink();
    const h = await joinLive(stranger, draftId, `?help=${first}`);
    const second = await helpLink();
    expect((await h.live.closed).code).toBe(4404);
    expect((await connect(stranger, draftId, `?help=${first}`).closed).code).toBe(4404);
    await joinLive(stranger, draftId, `?help=${second}`);

    server.advance(12 * 60 * 60 * 1000 + 1);
    expect((await connect(stranger, draftId, `?help=${second}`).closed).code).toBe(4404);
    expect((await stranger.call("GET", `/api/help/${second}`)).json.error.code).toBe("helpLinkNotFound");
    expect((await owner.call("GET", `/api/drafts/${draftId}/help-link`)).json.helpLink).toBeNull();
  });

  it("refuses a change from a helper whose link ran out while connected", async () => {
    const h = await joinLive(stranger, draftId, `?help=${await helpLink()}`);
    server.advance(12 * 60 * 60 * 1000 + 1);
    h.live.send({ type: "answer", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    expect(await h.live.closed).toEqual({ code: 4404, reason: "draftNotFound" });
    expect((await owner.call("GET", `/api/drafts/${draftId}`)).json.draft.version).toBe(1);
  });

  it("brings a lost connection back with the same link, and the state with it", async () => {
    const token = await helpLink();
    const a = await joinLive(owner);
    const h = await joinLive(stranger, draftId, `?help=${token}`);
    h.live.send({ type: "answer", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    await a.live.next("state");
    h.live.ws.terminate();
    await expect
      .poll(() => a.live.messages.filter((m) => m.type === "presence").at(-1)?.people.length)
      .toBe(1);

    // Meanwhile the owner goes on; the helper comes back and sees it.
    a.live.send({ type: "setLevel", version: 2, level: 2 });
    await a.live.next("state");
    const again = await joinLive(stranger, draftId, `?help=${token}`);
    expect(again.state.draft).toMatchObject({
      version: 3,
      level: 2,
      answers: { folk: { pick: "folk.hillfolk" } },
    });
    expect(again.welcome.you.id).not.toBe(h.welcome.you.id);
  });

  it("closes everyone's connection when the owner deletes the character", async () => {
    const b = await joinLive(gm);
    await owner.call("DELETE", `/api/drafts/${draftId}`);
    expect(await b.live.next("deleted")).toMatchObject({ draftId, source: { name: "owner" } });
    expect((await b.live.closed).code).toBe(4404);
  });

  it("drops the game master once the character leaves the campaign", async () => {
    const a = await joinLive(owner);
    const b = await joinLive(gm);
    await owner.call("PUT", `/api/drafts/${draftId}/campaign`, { campaignId: null });
    expect(await a.live.next("campaign")).toMatchObject({ version: 1, source: { role: "owner" } });
    expect((await b.live.closed).code).toBe(4404);
    await expect
      .poll(() => a.live.messages.filter((m) => m.type === "presence").at(-1)?.people.length)
      .toBe(1);
  });
});

/** A key for the client's account, as a program uses it. */
async function makeKey(c: Client): Promise<{ id: string; secret: string }> {
  const res = await c.call("POST", "/api/account/keys", { name: "Program" });
  expect(res.status).toBe(201);
  return res.json.key;
}

/** A request with a key only, no cookie: what a program sends. */
async function withKey(key: string, method: string, path: string, body?: unknown) {
  const res = await server.fetch(
    new Request(`http://builder.test${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return res.status;
}

async function version(): Promise<number> {
  return (await owner.call("GET", `/api/drafts/${draftId}`)).json.draft.version;
}

interface ChoiceState {
  id: string;
  kind: string;
  status: string;
  optional: boolean;
  options?: string[];
  count?: number;
  min?: number;
  recommended?: unknown;
}

function answerFor(c: ChoiceState): unknown {
  switch (c.kind) {
    case "pickOne":
      return { pick: (c.recommended as string[] | undefined)?.[0] ?? c.options![0] };
    case "pickMany": {
      const rec = (c.recommended as string[] | undefined) ?? [];
      return { picks: rec.length === c.count ? rec : c.options!.slice(0, c.count) };
    }
    case "distribute":
      return c.recommended;
    case "number":
      return { value: c.min };
    case "text":
      return { text: "Mira Fennwick" };
  }
  throw new Error(`no answer for ${c.kind}`);
}

/** Answers every open choice of the character, as its owner over HTTP; the last answer's view. */
async function answerAll(): Promise<Message> {
  let view = (await owner.call("GET", `/api/drafts/${draftId}`)).json;
  for (let guard = 0; guard < 80 && !view.evaluation.complete; guard++) {
    const next = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((c: string) => view.evaluation.choices[c] as ChoiceState)
      .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    const res = await owner.call("PUT", `/api/drafts/${draftId}/answers/${encodeURIComponent(next.id)}`, {
      version: view.draft.version,
      answer: answerFor(next),
    });
    expect(res.status, `${next.id}: ${JSON.stringify(res.json)}`).toBe(200);
    view = res.json;
  }
  return view;
}

/** The next `state` caused by a change of this kind (`changed`, `levelUp`, `finished`). */
async function nextEvent(live: Live, event: string): Promise<Message> {
  for (;;) {
    const m = await live.next("state");
    if (m.event === event) return m;
  }
}

describe("where a change comes from", () => {
  it("tells everyone on it every change, with the way it came, who made it and in which role", async () => {
    const own = await joinLive(owner, draftId, "?clientId=tab-1");
    const lead = await joinLive(gm);
    expect(own.welcome.you).toMatchObject({ via: "browser", clientId: "tab-1" });

    // A program with the owner's key.
    const key = await makeKey(owner);
    expect(await withKey(key.secret, "PATCH", `/api/drafts/${draftId}`, { version: 1, level: 2 })).toBe(200);
    for (const l of [own, lead]) {
      const e = await l.live.next("state");
      expect(e).toMatchObject({
        type: "state",
        event: "changed",
        by: null,
        draftId,
        version: 2,
        at: expect.any(String),
        source: { via: "api", name: "owner", role: "owner", clientId: null, connectionId: null },
        change: { kind: "level", level: 2 },
        draft: { version: 2, level: 2 },
      });
      // No account ids on the channel: a name and a role are enough.
      expect(JSON.stringify(e.source)).not.toContain("accountId");
    }

    // The public MCP server in the web app, with the same key.
    const mcp = createMcpRoute(server.app, server.fetch);
    const res = await mcp(
      new Request("http://builder.test/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.secret}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "set_level", arguments: { characterId: draftId, level: 3 } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    for (const l of [own, lead]) {
      expect((await l.live.next("state")).source).toMatchObject({
        via: "mcp",
        name: "owner",
        role: "owner",
      });
    }

    // The game master in the browser, from a window that names itself.
    const answer = await gm.call(
      "PATCH",
      `/api/drafts/${draftId}`,
      { version: await version(), level: 1 },
      { "x-builder-client-id": "gm-window" },
    );
    expect(answer.status).toBe(200);
    for (const l of [own, lead]) {
      expect((await l.live.next("state")).source).toMatchObject({
        via: "browser",
        name: "lead",
        role: "gameMaster",
        clientId: "gm-window",
      });
    }

    // Over the channel itself: the window's id from the address goes with it.
    own.live.send({ type: "setLevel", version: await version(), level: 2 });
    expect((await lead.live.next("state")).source).toMatchObject({
      via: "browser",
      clientId: "tab-1",
      connectionId: own.welcome.you.id,
    });
  });

  it("tells every way the character is stored: finish and raise, play state, copies", async () => {
    const lead = await joinLive(gm);
    const built = await answerAll();
    expect(await lead.live.next("state")).toMatchObject({
      event: "changed",
      change: { kind: "answer", choice: expect.any(String) },
    });
    const done = await owner.call("POST", `/api/drafts/${draftId}/finish`, { version: built.draft.version });
    expect(done.status).toBe(200);
    expect(await nextEvent(lead.live, "finished")).toMatchObject({
      version: built.draft.version + 1,
      draft: { status: "finished" },
    });
    const up = await owner.call("POST", `/api/drafts/${draftId}/level-up`, {
      version: built.draft.version + 1,
      level: 2,
    });
    expect(up.status).toBe(200);
    expect(await nextEvent(lead.live, "levelUp")).toMatchObject({ change: { kind: "levelUp", level: 2 } });
    // Copies are made of a finished character: finish the raise.
    const raised = await answerAll();
    if (raised.draft.status !== "finished") {
      await owner.call("POST", `/api/drafts/${draftId}/finish`, { version: raised.draft.version });
    }
    const now = await version();

    const state = await owner.call("PUT", `/api/drafts/${draftId}/state`, {
      version: 0,
      state: { hp: 7, note: "x", marks: { checks: 2 } },
    });
    expect(state.status).toBe(200);
    // The message names the fields that changed: the screen says which one.
    expect(await lead.live.next("playState")).toMatchObject({
      version: now,
      source: { name: "owner" },
      change: { kind: "state", stateVersion: 1, fields: ["hp", "marks", "note"], more: false },
    });
    await owner.call("PUT", `/api/drafts/${draftId}/state`, {
      version: 1,
      state: { hp: 5, note: "x", marks: { checks: 2 } },
    });
    expect(await lead.live.next("playState")).toMatchObject({
      change: { kind: "state", stateVersion: 2, fields: ["hp"], more: false },
    });
    await owner.call("PUT", `/api/drafts/${draftId}/state`, { version: 2, clearChecks: true });
    expect(await lead.live.next("playState")).toMatchObject({
      change: { kind: "clearChecks", stateVersion: 3, fields: ["marks"], more: false },
    });

    const copy = await owner.call("POST", `/api/drafts/${draftId}/sheet-copies`, {});
    expect(copy.status, JSON.stringify(copy.json)).toBe(201);
    const copyId = copy.json.copy.id;
    expect(await lead.live.next("copies")).toMatchObject({ change: { kind: "copyCreated", copyId } });
    await owner.call("PUT", `/api/drafts/${draftId}/sheet-copies/${copyId}`, { version: 1, name: "Neu" });
    expect(await lead.live.next("copies")).toMatchObject({ change: { kind: "copyChanged", copyId } });
    await owner.call("DELETE", `/api/drafts/${draftId}/sheet-copies/${copyId}`);
    expect(await lead.live.next("copies")).toMatchObject({ change: { kind: "copyDeleted", copyId } });
  });

  it("shows a program on the character, and how it came", async () => {
    const own = await joinLive(owner, draftId, "?clientId=tab-1");
    const key = await makeKey(gm);
    const program = connect(null, draftId, "", {
      authorization: `Bearer ${key.secret}`,
      "x-builder-client": "mcp",
    });
    expect((await program.next("welcome")).you).toMatchObject({ name: "lead", via: "mcp" });
    await expect
      .poll(() => own.live.messages.filter((m) => m.type === "presence").at(-1)?.people)
      .toMatchObject([
        { name: "owner", role: "owner", via: "browser", clientId: "tab-1" },
        { name: "lead", role: "gameMaster", via: "mcp", clientId: null },
      ]);
  });
});

describe("when a login ends", () => {
  it("closes a program's connection when its key is withdrawn", async () => {
    const key = await makeKey(owner);
    const program = connect(null, draftId, "", { authorization: `Bearer ${key.secret}` });
    expect((await program.next("welcome")).you).toMatchObject({ name: "owner", via: "api" });
    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    expect(await program.closed).toEqual({ code: 4401, reason: "keyNotValid" });
  });

  it("closes the connections of a login that logs out, and keeps the account's others", async () => {
    const a = await joinLive(owner);
    const second = new Client(server, "203.0.113.1");
    const login = await second.call("POST", "/api/auth/login", {
      login: "owner@example.org",
      password: ownerPassword,
    });
    expect(login.status).toBe(200);
    const elsewhere = await joinLive(second);
    await owner.call("POST", "/api/auth/logout");
    expect(await a.live.closed).toEqual({ code: 4401, reason: "notLoggedIn" });
    elsewhere.live.send({ type: "step", step: "folk" });
    expect((await elsewhere.live.next("presence")).people).toHaveLength(1);
  });

  it("closes the game master's connection when the player is removed", async () => {
    const b = await joinLive(gm);
    const campaignId = (await gm.call("GET", "/api/campaigns")).json.campaigns[0].id;
    const playerId = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json.players[0].id;
    expect((await gm.call("DELETE", `/api/campaigns/${campaignId}/players/${playerId}`)).status).toBe(204);
    expect((await b.live.closed).code).toBe(4404);
  });
});

describe("help links over HTTP", () => {
  it("are the owner's to make, show and withdraw; a game master gets 403, anyone else 404", async () => {
    expect((await owner.call("GET", `/api/drafts/${draftId}/help-link`)).json).toEqual({ helpLink: null });
    const made = await owner.call("POST", `/api/drafts/${draftId}/help-link`);
    expect(made.json.helpLink).toMatchObject({
      url: `http://builder.test/help/${made.json.helpLink.token}`,
      expiresAt: "2026-10-04T22:00:00.000Z",
    });
    expect((await owner.call("GET", `/api/drafts/${draftId}/help-link`)).json).toEqual(made.json);
    expect((await gm.call("POST", `/api/drafts/${draftId}/help-link`)).json.error.code).toBe("ownerOnly");
    expect((await stranger.call("GET", `/api/drafts/${draftId}/help-link`)).status).toBe(404);
  });

  it("tell whoever opens one whose character it is, and open the draft routes with ?help=", async () => {
    const token = await helpLink();
    const info = await stranger.call("GET", `/api/help/${token}`);
    expect(info.json).toEqual({
      draftId,
      owner: { name: "owner" },
      expiresAt: "2026-10-04T22:00:00.000Z",
      yours: false,
      live: `/api/live/drafts/${draftId}?help=${token}`,
    });
    expect((await owner.call("GET", `/api/help/${token}`)).json.yours).toBe(true);
    expect((await stranger.call("GET", `/api/help/${"x".repeat(22)}`)).status).toBe(404);

    expect((await stranger.call("GET", `/api/drafts/${draftId}`)).status).toBe(404);
    const seen = await stranger.call("GET", `/api/drafts/${draftId}?help=${token}`);
    expect(seen.json.draft).toMatchObject({ access: "helper", owner: { name: "owner" } });
    const changed = await stranger.call("PUT", `/api/drafts/${draftId}/answers/folk?help=${token}`, {
      version: 1,
      answer: { pick: "folk.hillfolk" },
    });
    expect(changed.json.draft).toMatchObject({ version: 2, access: "helper" });
    // Nothing else of the owner's: not deleting, not the prints, not the help link itself.
    expect((await stranger.call("DELETE", `/api/drafts/${draftId}?help=${token}`)).status).toBe(404);
    expect((await stranger.call("GET", `/api/drafts/${draftId}/help-link?help=${token}`)).status).toBe(404);
    expect((await stranger.call("GET", "/api/drafts")).json.drafts).toEqual([]);
  });
});
