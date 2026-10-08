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
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";
import { liveUpgradeHandler } from "./upgrade.ts";

let server: TestServer;
let http: Server;
let base: string;
let owner: Client;
let gm: Client;
let stranger: Client;
let draftId: string;
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
  await signIn(owner, "owner@example.org");
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
    expect(a.welcome.you).toMatchObject({ name: "owner", role: "owner" });
    expect(b.welcome.you).toMatchObject({ name: "lead", role: "gameMaster" });
    expect(b.state.draft).toMatchObject({ id: draftId, version: 1, access: "gameMaster" });
    expect(b.state.evaluation).not.toBeNull();

    a.live.send({ type: "answer", ref: "r1", version: 1, choice: "folk", answer: { pick: "folk.hillfolk" } });
    const seen = await b.live.next("state");
    expect(seen.draft).toMatchObject({ version: 2, answers: { folk: { pick: "folk.hillfolk" } } });
    expect(seen.by).toEqual({ id: a.welcome.you.id, name: "owner" });
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
    expect(seen).toMatchObject({ by: null, draft: { version: 2 } });
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
      from: { id: b.welcome.you.id, name: "lead" },
      text: "Schau dir den Schritt Zauber an",
    });
    await expect
      .poll(() => b.live.messages.filter((m) => m.type === "presence").at(-1)?.people)
      .toEqual([
        { id: a.welcome.you.id, name: "owner", role: "owner", step: "folk", point: null },
        { id: b.welcome.you.id, name: "lead", role: "gameMaster", step: null, point: "folk.hillfolk" },
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
    expect((await a.live.next("state")).by.name).toBe("helper");
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
    expect((await b.live.closed).code).toBe(4404);
  });

  it("drops the game master once the character leaves the campaign", async () => {
    const b = await joinLive(gm);
    await owner.call("PUT", `/api/drafts/${draftId}/campaign`, { campaignId: null });
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
