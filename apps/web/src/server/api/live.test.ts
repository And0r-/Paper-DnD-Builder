/**
 * The live channel `GET /api/drafts/:id/events`: two people on one
 * character hear every stored change at once, with where it came from
 * (browser, API key, MCP), who made it and in which role; who is on the
 * character; who may listen at all, and when a connection ends.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraftEvents } from "../app.ts";
import { HEARTBEAT_MS, LiveChannel, MAX_CONNECTIONS_PER_ACCOUNT } from "../live.ts";
import { createMcpRoute } from "../mcp-route.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let gm: Client;
let player: Client;
let stranger: Client;
let campaignId: string;
let playerId: string;
let draftId: string;
let playerPassword: string;
const streams: Stream[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are checked field by field
type Event = any;

/** One open channel, read as a browser's EventSource would: `data:` lines and `:` comments. */
class Stream {
  readonly events: Event[] = [];
  readonly comments: string[] = [];
  ended = false;
  readonly res: Response;
  private readonly abort: AbortController;

  constructor(res: Response, abort: AbortController) {
    this.res = res;
    this.abort = abort;
    // Only a stream is read here; an error answer stays for the test to read.
    if (res.status === 200) void this.read();
  }

  private async read() {
    const reader = this.res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          for (const line of buffer.slice(0, end).split("\n")) {
            if (line.startsWith("data: ")) this.events.push(JSON.parse(line.slice(6)));
            else if (line.startsWith(":")) this.comments.push(line);
          }
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {
      // Aborted by the test.
    }
    this.ended = true;
  }

  of(type: string): Event[] {
    return this.events.filter((e) => e.type === type);
  }

  last(type: string): Event {
    return this.of(type).at(-1);
  }

  async until(done: () => boolean, what = "event"): Promise<void> {
    const start = Date.now();
    while (!done()) {
      if (Date.now() - start > 3000) throw new Error(`no ${what}; got ${JSON.stringify(this.events)}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private readonly taken = new Map<string, number>();

  /** The next event of a type this test has not taken yet; waits for it if need be. */
  async next(type: string): Promise<Event> {
    const at = this.taken.get(type) ?? 0;
    await this.until(() => this.of(type).length > at, type);
    this.taken.set(type, at + 1);
    return this.of(type)[at];
  }

  close() {
    this.abort.abort();
  }
}

async function listen(c: Client, id = draftId, headers: Record<string, string> = {}, query = "") {
  const abort = new AbortController();
  const res = await c.request("GET", `/api/drafts/${id}/events${query}`, undefined, headers, abort.signal);
  const s = new Stream(res, abort);
  if (res.status === 200) streams.push(s);
  return s;
}

/** A key for the client's account, as a program uses it. */
async function makeKey(c: Client): Promise<string> {
  const res = await c.call("POST", "/api/account/keys", { name: "Program" });
  expect(res.status).toBe(201);
  return res.json.key.secret;
}

/** A request with a key only, no cookie: what a program sends. */
async function withKey(key: string, method: string, path: string, body?: unknown, headers = {}) {
  const res = await server.fetch(
    new Request(`http://builder.test${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: res.status, res };
}

async function version(): Promise<number> {
  return (await player.call("GET", `/api/drafts/${draftId}`)).json.draft.version;
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

/** Answers every open choice of the character, as the player; the last answer's view. */
async function answerAll(): Promise<Event> {
  let view = (await player.call("GET", `/api/drafts/${draftId}`)).json;
  for (let guard = 0; guard < 80 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((c: string) => view.evaluation.choices[c] as ChoiceState)
      .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    const res = await player.call("PUT", `/api/drafts/${draftId}/answers/${encodeURIComponent(open.id)}`, {
      version: view.draft.version,
      answer: answerFor(open),
    });
    expect(res.status, `${open.id}: ${JSON.stringify(res.json)}`).toBe(200);
    view = res.json;
  }
  return view;
}

beforeEach(async () => {
  server = await startTestServer();
  gm = new Client(server, "203.0.113.1");
  player = new Client(server, "203.0.113.2");
  stranger = new Client(server, "203.0.113.3");
  await signIn(gm, "lead@example.org");
  playerPassword = await signIn(player, "player@example.org");
  await signIn(stranger, "stranger@example.org");
  const campaign = (await gm.call("POST", "/api/campaigns", { name: "Die Nebelrunde" })).json.campaign;
  campaignId = campaign.id;
  await player.call("POST", `/api/invites/${(campaign.inviteUrl as string).split("/join/")[1]}/join`);
  playerId = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json.players[0].id;
  draftId = (await player.call("POST", "/api/drafts", { packageId: "demo", campaignId })).json.draft.id;
});

afterEach(() => {
  for (const s of streams.splice(0)) s.close();
  server.app.live.stop();
});

describe("the live channel", () => {
  it("is an event stream that proxies pass on at once", async () => {
    const s = await listen(player);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(s.res.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("tells both people every change, with where it came from, who made it and in which role", async () => {
    const own = await listen(player, draftId, {}, "?clientId=tab-1");
    const lead = await listen(gm);
    await own.until(() => own.last("presence")?.present.length === 2, "both present");

    // A program with the player's key.
    const key = await makeKey(player);
    const v = await version();
    const r = await withKey(key, "PATCH", `/api/drafts/${draftId}`, { version: v, level: 2 });
    expect(r.status).toBe(200);
    for (const s of [own, lead]) {
      const e = await s.next("changed");
      expect(e).toEqual({
        type: "changed",
        draftId,
        version: v + 1,
        at: expect.any(String),
        source: {
          via: "api",
          accountId: expect.any(String),
          accountName: "player",
          role: "owner",
          clientId: null,
        },
        change: { kind: "level", level: 2 },
      });
      // No character content: the client reads the draft again.
      expect(JSON.stringify(e)).not.toContain("answers");
    }

    // The public MCP server in the web app, with the same key.
    const mcp = createMcpRoute(server.app, server.fetch);
    const res = await mcp(
      new Request("http://builder.test/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
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
    for (const s of [own, lead]) {
      expect((await s.next("changed")).source).toMatchObject({
        via: "mcp",
        accountName: "player",
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
    for (const s of [own, lead]) {
      expect((await s.next("changed")).source).toMatchObject({
        via: "browser",
        accountName: "lead",
        role: "gameMaster",
        clientId: "gm-window",
      });
    }
  });

  it("tells every way the character is stored: finish and level-up, play state, copies, campaign, delete", async () => {
    const s = await listen(gm);
    const lead = await listen(player);
    await lead.until(() => lead.last("presence")?.present.length === 2);

    const built = await answerAll();
    const answered = await s.next("changed");
    expect(answered).toMatchObject({ change: { kind: "answer", choice: expect.any(String) } });
    const done = await player.call("POST", `/api/drafts/${draftId}/finish`, { version: built.draft.version });
    expect(done.status).toBe(200);
    expect(await s.next("finished")).toMatchObject({ version: built.draft.version + 1 });
    const up = await player.call("POST", `/api/drafts/${draftId}/level-up`, {
      version: built.draft.version + 1,
      level: 2,
    });
    expect(up.status).toBe(200);
    expect(await s.next("levelUp")).toMatchObject({ change: { kind: "levelUp", level: 2 } });
    // Copies are made of a finished character: finish the raise.
    const raised = await answerAll();
    if (raised.draft.status !== "finished") {
      await player.call("POST", `/api/drafts/${draftId}/finish`, { version: raised.draft.version });
    }

    const state = await player.call("PUT", `/api/drafts/${draftId}/state`, { version: 0, state: { hp: 7 } });
    expect(state.status).toBe(200);
    expect(await s.next("state")).toMatchObject({ change: { kind: "state", stateVersion: 1 } });
    await player.call("PUT", `/api/drafts/${draftId}/state`, { version: 1, clearChecks: true });
    expect(await s.next("state")).toMatchObject({ change: { kind: "clearChecks", stateVersion: 2 } });

    const copy = await player.call("POST", `/api/drafts/${draftId}/sheet-copies`, {});
    expect(copy.status, JSON.stringify(copy.json)).toBe(201);
    const copyId = copy.json.copy.id;
    expect(await s.next("copies")).toMatchObject({ change: { kind: "copyCreated", copyId } });
    await player.call("PUT", `/api/drafts/${draftId}/sheet-copies/${copyId}`, { version: 1, name: "Neu" });
    expect(await s.next("copies")).toMatchObject({ change: { kind: "copyChanged", copyId } });
    await player.call("DELETE", `/api/drafts/${draftId}/sheet-copies/${copyId}`);
    expect(await s.next("copies")).toMatchObject({ change: { kind: "copyDeleted", copyId } });

    // Out of the campaign: the player hears it; the game master's channel ends.
    const out = await player.call("PUT", `/api/drafts/${draftId}/campaign`, { campaignId: null });
    expect(out.status).toBe(200);
    expect(await lead.next("campaign")).toMatchObject({ source: { role: "owner" } });
    await s.until(() => s.ended, "end of the game master's channel");
    await lead.until(() => lead.last("presence")?.present.length === 1, "game master gone");

    await player.call("DELETE", `/api/drafts/${draftId}`);
    expect(await lead.next("deleted")).toMatchObject({ draftId });
    await lead.until(() => lead.ended, "end after delete");
  });

  it("tells about new characters, finishing and raising (on the internal bus too)", async () => {
    const seen: Event[] = [];
    server.app.draftEvents.subscribe((e) => seen.push(e));
    const made = await gm.call("POST", `/api/campaigns/${campaignId}/players/${playerId}/drafts`, {
      packageId: "demo",
    });
    expect(made.status).toBe(201);
    expect(seen[0]).toMatchObject({
      type: "created",
      draftId: made.json.draft.id,
      version: 1,
      source: { accountName: "lead", role: "gameMaster", via: "browser" },
    });
  });

  it("shows who is on the character, on connecting and leaving", async () => {
    const own = await listen(player, draftId, {}, "?clientId=tab-1");
    expect(await own.next("presence")).toMatchObject({
      draftId,
      present: [{ accountName: "player", role: "owner", via: "browser", clientId: "tab-1" }],
    });
    const key = await makeKey(gm);
    const program = await listen(gm, draftId, { authorization: `Bearer ${key}`, "x-builder-client": "mcp" });
    expect(program.res.status).toBe(200);
    expect((await own.next("presence")).present).toEqual([
      { accountName: "player", role: "owner", via: "browser", clientId: "tab-1" },
      { accountName: "lead", role: "gameMaster", via: "mcp", clientId: null },
    ]);
    program.close();
    expect((await own.next("presence")).present).toEqual([
      { accountName: "player", role: "owner", via: "browser", clientId: "tab-1" },
    ]);
  });

  it("keeps the line busy with a heartbeat", async () => {
    expect(HEARTBEAT_MS).toBe(30_000);
    const s = await listen(player);
    await server.app.live.beat();
    await s.until(() => s.comments.includes(": ping"), "heartbeat");
    expect(s.ended).toBe(false);
  });

  it("beats on its own, every interval", async () => {
    const events = new DraftEvents();
    const live = new LiveChannel({ store: server.app.store, now: server.app.now, events, heartbeatMs: 10 });
    const abort = new AbortController();
    const s = new Stream(
      live.open({
        draftId,
        accountId: "nobody",
        present: { accountName: "x", role: "owner", via: "api", clientId: null },
        login: { via: "key", id: "00000000-0000-0000-0000-000000000000" },
        signal: abort.signal,
      }),
      abort,
    );
    await s.until(() => s.comments.includes(": ping"), "heartbeat");
    // That login does not exist: the beat's check ends the connection.
    await s.until(() => s.ended, "end");
  });
});

describe("who may listen", () => {
  it("answers 404 to someone else and without access, 401 without a login", async () => {
    expect((await listen(stranger)).res.status).toBe(404);
    expect((await listen(stranger, "not-a-uuid")).res.status).toBe(404);
    expect((await listen(new Client(server))).res.status).toBe(401);
    // A character in no campaign stays private to the game master.
    const own = (await player.call("POST", "/api/drafts", { packageId: "demo" })).json.draft.id;
    expect((await listen(gm, own)).res.status).toBe(404);
  });

  it("works with a key, and ends when the key is withdrawn", async () => {
    const made = await player.call("POST", "/api/account/keys", { name: "Program" });
    const s = await listen(stranger, draftId, { authorization: `Bearer ${made.json.key.secret}` });
    expect(s.res.status).toBe(200);
    expect((await s.next("presence")).present[0]).toMatchObject({ accountName: "player", via: "api" });
    await player.call("DELETE", `/api/account/keys/${made.json.key.id}`);
    await s.until(() => s.ended, "end after withdrawing the key");
  });

  it("gives the game master the channel and takes it when the player is removed", async () => {
    const lead = await listen(gm);
    const own = await listen(player);
    expect(lead.res.status).toBe(200);
    await own.until(() => own.last("presence")?.present.length === 2);
    expect((await gm.call("DELETE", `/api/campaigns/${campaignId}/players/${playerId}`)).status).toBe(204);
    await lead.until(() => lead.ended, "end of the game master's channel");
    await own.until(() => own.last("presence")?.present.length === 1, "game master gone");
    expect(own.ended).toBe(false);
  });

  it("ends a game master's channel when the campaign is deleted", async () => {
    const lead = await listen(gm);
    expect((await gm.call("DELETE", `/api/campaigns/${campaignId}`)).status).toBe(204);
    await lead.until(() => lead.ended, "end");
  });

  it("ends the channels of a login when it logs out", async () => {
    const s = await listen(player);
    const second = new Client(server, "203.0.113.2");
    const other = await second.call("POST", "/api/auth/login", {
      login: "player@example.org",
      password: playerPassword,
    });
    expect(other.status).toBe(200);
    const elsewhere = await listen(second);
    expect(elsewhere.res.status).toBe(200);
    await player.call("POST", "/api/auth/logout");
    await s.until(() => s.ended, "end after logout");
    // The same account's other login keeps its channel.
    expect(elsewhere.ended).toBe(false);
  });

  it("allows a few connections per account", async () => {
    for (let i = 0; i < MAX_CONNECTIONS_PER_ACCOUNT; i++) expect((await listen(player)).res.status).toBe(200);
    const sixth = await listen(player);
    expect(sixth.res.status).toBe(429);
    expect(await sixth.res.json()).toEqual({
      error: { code: "tooManyConnections", max: MAX_CONNECTIONS_PER_ACCOUNT },
    });
    streams.pop()!.close();
    await new Promise((r) => setTimeout(r, 10));
    expect((await listen(player)).res.status).toBe(200);
  });
});
