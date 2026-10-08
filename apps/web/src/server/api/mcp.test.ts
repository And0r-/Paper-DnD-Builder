/**
 * The tool list of @builder/mcp against this server with the demo package,
 * over the public API with nothing but an access key: a character built
 * from empty to finished, raised, printed; a withdrawn key; someone else's
 * character; a change made elsewhere in between. Then the same tools over
 * the stateless HTTP server, spoken to by the MCP library's own client.
 */
import {
  ApiClient,
  createHttpHandler,
  PackageCache,
  TOOLS,
  type ToolName,
  type ToolResult,
} from "@builder/mcp";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let owner: Client;

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server);
  await signIn(owner, "owner@example.org", "en");
});

async function makeKey(client: Client = owner): Promise<{ id: string; secret: string }> {
  const res = await client.call("POST", "/api/account/keys", { name: "Language model" });
  expect(res.status).toBe(201);
  return res.json.key;
}

/** What the stdio server does, minus stdio: the shared tools with an ApiClient on this server. */
function toolsWith(key: string) {
  const client = new ApiClient({
    baseUrl: "http://builder.test",
    key,
    fetch: (input, init) => server.fetch(new Request(input, init)),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool data is checked field by field
  return async (name: ToolName, input: Record<string, unknown> = {}): Promise<ToolResult & { data: any }> => {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.run(client, input);
  };
}

type Call = ReturnType<typeof toolsWith>;

const MCP_URL = "http://mcp.test/mcp";

/** The public HTTP server in front of this builder; texts shared across requests as in production. */
function httpServer(fetched: string[] = []) {
  return createHttpHandler({
    apiBaseUrl: "http://builder.test",
    allowedOrigins: ["https://builder.example"],
    packages: new PackageCache(),
    fetch: (input, init) => {
      const req = new Request(input, init);
      fetched.push(`${req.method} ${new URL(req.url).pathname}`);
      return server.fetch(req);
    },
  });
}

/** An MCP program that sends `key` as Bearer to the HTTP server, mapping each answer back to a ToolResult. */
async function httpToolsWith(key: string, handler = httpServer()): Promise<Call> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => handler(new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
  const client = new McpClient({ name: "test", version: "0" });
  // The library's own `sessionId?: string` does not fit its interface under exactOptionalPropertyTypes.
  await client.connect(transport as unknown as Transport);
  return async (name, input = {}) => {
    const res = await client.callTool({ name, arguments: input });
    const content = res.content as { type: string; text?: string; resource?: Record<string, string> }[];
    const resource = content.find((c) => c.type === "resource")?.resource;
    return {
      data: JSON.parse(content[0]!.text!),
      ...(res.isError ? { isError: true } : {}),
      ...(resource
        ? { file: { name: resource["uri"]!, mimeType: resource["mimeType"]!, data: resource["blob"]! } }
        : {}),
    };
  };
}

function postMcp(handler: ReturnType<typeof httpServer>, headers: Record<string, string>, body?: unknown) {
  return handler(
    new Request(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body ?? { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
}

/** A model that takes the recommendation, else the first options, using only what list_options says. */
async function answerAllOpen(call: Call, characterId: string): Promise<string[]> {
  const answered: string[] = [];
  for (let round = 0; round < 100; round++) {
    const open = await call("list_open_choices", { characterId });
    expect(open.isError).toBeFalsy();
    const next = open.data.openChoices[0];
    if (!next) return answered;
    expect(next.title).not.toBe(next.choice);
    const options = await call("list_options", { characterId, choice: next.choice });
    expect(options.isError, JSON.stringify(options.data)).toBeFalsy();
    const o = options.data;
    let answer: unknown;
    switch (o.kind) {
      case "pickOne": {
        const best = o.options.find((x: { recommended?: number }) => x.recommended === 1) ?? o.options[0];
        answer = { pick: best.option };
        break;
      }
      case "pickMany": {
        const ranked = [...o.options].sort(
          (a: { recommended?: number }, b: { recommended?: number }) =>
            (a.recommended ?? 999) - (b.recommended ?? 999),
        );
        const held: string[] = (o.currentAnswer?.picks as string[] | undefined) ?? [];
        const more = ranked.map((x: { option: string }) => x.option).filter((x: string) => !held.includes(x));
        answer = { picks: [...held, ...more].slice(0, o.count) };
        break;
      }
      case "distribute":
        answer = o.recommended;
        break;
      case "number":
        answer = { value: o.min };
        break;
      case "text":
        answer = { text: "Mira Fennwick" };
        break;
    }
    const set = await call("set_answer", { characterId, choice: next.choice, answer });
    expect(set.isError, JSON.stringify(set.data)).toBeFalsy();
    expect(set.data.done).toBe(true);
    answered.push(next.choice);
  }
  throw new Error("choices never ran out");
}

async function firstOpen(call: Call, characterId: string, kind: string): Promise<{ choice: string }> {
  const open = (await call("list_open_choices", { characterId })).data.openChoices;
  const found = open.find((c: { kind: string }) => c.kind === kind);
  if (!found) throw new Error(`no open ${kind} choice`);
  return found;
}

describe("the shared tools over the API, with nothing but a key", () => {
  it.each([
    ["directly", async (key: string) => toolsWith(key)],
    ["over HTTP", httpToolsWith],
  ])(
    "build a level-3 character from empty to finished, raise it to 5, and get its sheet (%s)",
    async (_how, make) => {
      const call = await make((await makeKey()).secret);

      const packages = await call("list_packages");
      expect(packages.data.map((p: { packageId: string }) => p.packageId)).toContain("demo");
      expect(packages.data.find((p: { packageId: string }) => p.packageId === "demo").name).toBeTruthy();

      const started = await call("start_character", { packageId: "demo", level: 3 });
      expect(started.isError).toBeFalsy();
      const characterId: string = started.data.characterId;
      expect(started.data).toMatchObject({ level: 3, state: "open", canFinish: false });
      expect(started.data.openChoices.length).toBeGreaterThan(0);
      // No half summary line (" · Level 3") while what it names is not chosen.
      expect((await call("list_characters")).data[0]).toMatchObject({ name: null, summary: null });

      // Finishing too early names what is open.
      const early = await call("finish_character", { characterId });
      expect(early.isError).toBe(true);
      expect(early.data.openChoices.length).toBeGreaterThan(0);

      const answered = await answerAllOpen(call, characterId);
      expect(answered.length).toBeGreaterThan(5);

      const finished = await call("finish_character", { characterId });
      expect(finished.isError, JSON.stringify(finished.data)).toBeFalsy();
      expect(finished.data).toMatchObject({ done: true, state: "finished", level: 3, openChoices: [] });

      const listed = await call("list_characters");
      expect(listed.data).toEqual([
        expect.objectContaining({ characterId, name: "Mira Fennwick", level: 3, state: "finished" }),
      ]);
      expect(listed.data[0].summary).toEqual(expect.any(String));

      // Raise to 5: only what the new levels ask.
      const raised = await call("level_up", { characterId, level: 5 });
      expect(raised.isError, JSON.stringify(raised.data)).toBeFalsy();
      expect(raised.data.raised).toEqual({ from: 3, to: 5 });
      // toAnswer is everything open: the new choices, and older ones that ask for more at the
      // higher level, each marked; a model answering only the new ones would get stuck.
      const openIds = raised.data.openChoices.map((c: { choice: string }) => c.choice);
      const toAnswer: { choice: string; new?: true; morePlaces?: true }[] = raised.data.toAnswer;
      expect(toAnswer.map((c) => c.choice)).toEqual(openIds);
      expect(toAnswer.filter((c) => c.new).length).toBeGreaterThan(0);
      expect(toAnswer.filter((c) => c.morePlaces).length).toBeGreaterThan(0);
      for (const c of toAnswer) expect(Boolean(c.new) !== Boolean(c.morePlaces), c.choice).toBe(true);
      const answeredAt5 = await answerAllOpen(call, characterId);
      // A copy (`<choice>@<pick>`) comes once the pick that brings it is answered.
      expect(answeredAt5.filter((id) => !id.includes("@"))).toEqual(openIds);
      const done = await call("finish_character", { characterId });
      expect(done.data).toMatchObject({ done: true, state: "finished", level: 5 });

      // Reading: values with names, what it has, answers in words.
      const character = await call("get_character", { characterId });
      expect(character.data).toMatchObject({
        characterId,
        level: 5,
        state: "finished",
        name: "Mira Fennwick",
      });
      expect(character.data.values.length).toBeGreaterThan(3);
      expect(character.data.has.length).toBeGreaterThan(3);
      for (const t of character.data.has) expect(t.name).not.toBe(t.thing);
      const value = character.data.values[0];
      expect(value.name).not.toBe(value.value);

      const explained = await call("explain_value", { characterId, value: value.value });
      expect(explained.isError, JSON.stringify(explained.data)).toBeFalsy();
      expect(explained.data).toMatchObject({ value: value.value, name: value.name, total: value.number });

      const unknownValue = await call("explain_value", { characterId, value: "no-such-value" });
      expect(unknownValue.isError).toBe(true);

      // The sheet as data, then as the PDF.
      const sheet = await call("get_sheet", { characterId });
      expect(sheet.isError, JSON.stringify(sheet.data).slice(0, 500)).toBeFalsy();
      expect(sheet.data).toMatchObject({ name: "Mira Fennwick", level: 5, language: "en" });

      const pdf = await call("get_sheet", { characterId, as: "pdf", parts: ["sheet"] });
      expect(pdf.isError).toBeFalsy();
      expect(pdf.file?.mimeType).toBe("application/pdf");
      expect(Buffer.from(pdf.file!.data, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    },
  );

  it("says in words why the rules refuse an answer, and nothing changes", async () => {
    const call = toolsWith((await makeKey()).secret);
    const { characterId } = (await call("start_character", { packageId: "demo", level: 1 })).data;
    const first = await firstOpen(call, characterId, "pickOne");

    const wrong = await call("set_answer", {
      characterId,
      choice: first.choice,
      answer: { pick: "no.such-thing" },
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.data.message).toMatch(/not among the options/);

    const notAsked = await call("list_options", { characterId, choice: "no-such-choice" });
    expect(notAsked.isError).toBe(true);
    expect((await call("get_character", { characterId })).data.answered).toEqual([]);
  });

  it("does not overwrite a change made elsewhere, and says what changed", async () => {
    const call = toolsWith((await makeKey()).secret);
    const { characterId } = (await call("start_character", { packageId: "demo", level: 1 })).data;
    const a = await firstOpen(call, characterId, "pickOne");
    const optionsA = (await call("list_options", { characterId, choice: a.choice })).data.options;

    // The player changes the level in the browser meanwhile.
    const before = await owner.call("GET", `/api/drafts/${characterId}`);
    const moved = await owner.call("PATCH", `/api/drafts/${characterId}`, {
      version: before.json.draft.version,
      level: 2,
    });
    expect(moved.status).toBe(200);

    const refused = await call("set_answer", {
      characterId,
      choice: a.choice,
      answer: { pick: optionsA[0].option },
    });
    expect(refused.isError).toBeFalsy();
    expect(refused.data.done).toBe(false);
    expect(refused.data.changedElsewhere.level).toEqual({ from: 1, to: 2 });
    expect(refused.data.now.level).toBe(2);
    expect((await owner.call("GET", `/api/drafts/${characterId}`)).json.draft.answers).toEqual({});

    // The client now holds the new version: the same answer goes through.
    const again = await call("set_answer", {
      characterId,
      choice: a.choice,
      answer: { pick: optionsA[0].option },
    });
    expect(again.data.done).toBe(true);
  });

  it("gives a clear message for a withdrawn key", async () => {
    const key = await makeKey();
    const call = toolsWith(key.secret);
    expect((await call("list_characters")).isError).toBeFalsy();

    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    for (const name of ["list_characters", "list_packages"] as const) {
      const res = await call(name);
      expect(res.isError).toBe(true);
      expect(res.data.message).toMatch(/does not accept the access key/);
      // Both places a key can be, the program's BUILDER_KEY first, and where to make a new one.
      expect(res.data.message).toMatch(/Settings, Access keys/);
      expect(res.data.message).toMatch(/BUILDER_KEY/);
      expect(res.data.message).toMatch(/config\.json/);
    }
  });

  it("does not see someone else's character", async () => {
    const other = new Client(server, "203.0.113.8");
    await signIn(other, "other@example.org");
    const theirs = await other.call("POST", "/api/drafts", { packageId: "demo" });
    expect(theirs.status).toBe(201);
    const theirId: string = theirs.json.draft.id;

    const call = toolsWith((await makeKey()).secret);
    expect((await call("list_characters")).data).toEqual([]);
    for (const [name, input] of [
      ["get_character", { characterId: theirId }],
      ["list_open_choices", { characterId: theirId }],
      ["explain_value", { characterId: theirId, value: "level" }],
      ["set_level", { characterId: theirId, level: 2 }],
      ["finish_character", { characterId: theirId }],
      ["get_sheet", { characterId: theirId }],
    ] as const) {
      const res = await call(name, input);
      expect(res.isError, name).toBe(true);
      expect(res.data.message, name).toMatch(/no character with this id/);
    }
    const still = await other.call("GET", `/api/drafts/${theirId}`);
    expect(still.json.draft).toMatchObject({ level: 1, version: 1 });
  });
});

describe("the HTTP server: a key per request, nothing kept between requests", () => {
  it("answers 401 without a key, with a wrong key and with a withdrawn one", async () => {
    const handler = httpServer();
    const none = await postMcp(handler, {});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await none.json()).error.message).toMatch(/Settings, Access keys/);

    expect((await postMcp(handler, { authorization: "Bearer cbk_not-a-real-key" })).status).toBe(401);
    expect((await postMcp(handler, { authorization: "Basic dXNlcjpwYXNz" })).status).toBe(401);

    const key = await makeKey();
    const ok = await postMcp(handler, { authorization: `Bearer ${key.secret}` });
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.tools).toHaveLength(TOOLS.length);

    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    const withdrawn = await postMcp(handler, { authorization: `Bearer ${key.secret}` });
    expect(withdrawn.status).toBe(401);
    expect((await withdrawn.json()).error.message).toMatch(/not valid/);
  });

  it("with key A shows only A's characters, never B's", async () => {
    const other = new Client(server, "203.0.113.8");
    await signIn(other, "other@example.org");
    const theirs = await other.call("POST", "/api/drafts", { packageId: "demo" });
    const theirId: string = theirs.json.draft.id;
    const keyB = (await other.call("POST", "/api/account/keys", { name: "B" })).json.key.secret as string;

    const handler = httpServer();
    const callA = await httpToolsWith((await makeKey()).secret, handler);
    const callB = await httpToolsWith(keyB, handler);
    const mine = (await callA("start_character", { packageId: "demo", level: 1 })).data.characterId;

    expect((await callA("list_characters")).data.map((c: { characterId: string }) => c.characterId)).toEqual([
      mine,
    ]);
    expect((await callB("list_characters")).data.map((c: { characterId: string }) => c.characterId)).toEqual([
      theirId,
    ]);
    for (const [name, input] of [
      ["get_character", { characterId: theirId }],
      ["set_level", { characterId: theirId, level: 2 }],
      ["get_sheet", { characterId: theirId }],
    ] as const) {
      const res = await callA(name, input);
      expect(res.isError, name).toBe(true);
      expect(res.data.message, name).toMatch(/no character with this id/);
    }
    expect((await callB("get_character", { characterId: mine })).isError).toBe(true);
    expect((await other.call("GET", `/api/drafts/${theirId}`)).json.draft).toMatchObject({
      level: 1,
      version: 1,
    });
  });

  it("reads the version afresh before each change, and loads package texts once", async () => {
    const fetched: string[] = [];
    const call = await httpToolsWith((await makeKey()).secret, httpServer(fetched));
    const { characterId } = (await call("start_character", { packageId: "demo", level: 1 })).data;

    // The player changes the level in the browser between two requests: the next change still goes through.
    const before = await owner.call("GET", `/api/drafts/${characterId}`);
    await owner.call("PATCH", `/api/drafts/${characterId}`, { version: before.json.draft.version, level: 2 });
    const raised = await call("set_level", { characterId, level: 3 });
    expect(raised.isError, JSON.stringify(raised.data)).toBeFalsy();
    expect((await owner.call("GET", `/api/drafts/${characterId}`)).json.draft.level).toBe(3);

    await call("get_character", { characterId });
    const texts = fetched.filter((f) => f.startsWith("GET /api/packages/demo/texts/"));
    expect(texts).toHaveLength(1);
  });

  it("refuses a browser from another origin, lets programs without one through", async () => {
    const handler = httpServer();
    const auth = { authorization: `Bearer ${(await makeKey()).secret}` };
    const evil = await postMcp(handler, { ...auth, origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    expect((await postMcp(handler, { ...auth, origin: "https://builder.example" })).status).toBe(200);
    expect((await postMcp(handler, auth)).status).toBe(200);
    // Before the key is even looked at.
    expect((await postMcp(handler, { origin: "http://evil.example" })).status).toBe(403);
  });

  it("takes POST only: no sessions, no open stream", async () => {
    const res = await httpServer()(new Request(MCP_URL, { method: "GET" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

/**
 * The demo package with its callings as tracks (package format SPEC 9.7),
 * named with their levels in the summary line; the river runner needs more
 * grace than the demo's scores give.
 */
async function demoWithTracksDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "demo-tracks-"));
  await cp(DEMO_PACKAGE_DIR, dir, {
    recursive: true,
    filter: (src) =>
      !src.includes("node_modules") && !src.startsWith(path.join(DEMO_PACKAGE_DIR, "extensions")),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package files are edited field by field
  const edit = async (file: string, change: (json: any) => void) => {
    const json = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    change(json);
    await writeFile(path.join(dir, file), JSON.stringify(json));
  };
  await edit("flow.json", (flow) => {
    flow.level.tracks = { choice: "calling", addRequiresCurrent: true };
    flow.summary.line.calling = { tracks: true };
  });
  await edit("things/callings-and-paths.json", (things) => {
    things.find((t: { id: string }) => t.id === "calling.river-runner").addRequires = "grace >= 30";
  });
  for (const [language, reason] of [
    ["en", "Needs grace 30 or more."],
    ["de", "Braucht Geschick 30 oder mehr."],
  ])
    await edit(`texts/${language}/core.json`, (texts) => {
      texts.entries["calling.river-runner.addReason"] = reason;
    });
  return dir;
}

describe("tracks over MCP", () => {
  it("raises a level-3 character into a second calling, and says why another is not allowed", async () => {
    const dir = await demoWithTracksDir();
    try {
      server = await startTestServer({ packagesDir: dir });
      owner = new Client(server);
      await signIn(owner, "owner@example.org", "en");
      const call = toolsWith((await makeKey()).secret);

      const started = await call("start_character", { packageId: "demo", level: 3 });
      const characterId: string = started.data.characterId;
      const calling = await call("set_answer", {
        characterId,
        choice: "calling",
        answer: { pick: "calling.lantern-bearer" },
      });
      expect(calling.isError, JSON.stringify(calling.data)).toBeFalsy();
      await answerAllOpen(call, characterId);
      expect((await call("finish_character", { characterId })).data).toMatchObject({ done: true, level: 3 });

      const before = await call("get_character", { characterId });
      expect(before.data.tracks).toMatchObject({
        levels: [{ thing: "calling.lantern-bearer", name: "Lantern Bearer", levels: 3, first: true }],
      });
      expect(before.data.tracks.nextLevel).toContainEqual({
        thing: "calling.river-runner",
        name: "River Runner",
        allowed: false,
        because: ["Needs grace 30 or more."],
      });

      const refused = await call("level_up", { characterId, level: 4, tracks: ["calling.river-runner"] });
      expect(refused.isError).toBe(true);
      expect(refused.data.because).toEqual(["Needs grace 30 or more."]);

      const raised = await call("level_up", { characterId, level: 4, tracks: ["calling.herbalist"] });
      expect(raised.isError, JSON.stringify(raised.data)).toBeFalsy();
      expect(raised.data.raised).toEqual({ from: 3, to: 4 });
      // The herbalist's choices come as copies of their own (a flow step of the demo for herbalists too).
      const fresh = raised.data.toAnswer
        .filter((c: { new?: true }) => c.new)
        .map((c: { choice: string }) => c.choice);
      expect(fresh).toContain("talents-herbalist@calling.herbalist");
      expect(fresh.every((c: string) => c.endsWith("@calling.herbalist"))).toBe(true);
      await answerAllOpen(call, characterId);
      expect((await call("finish_character", { characterId })).data).toMatchObject({ done: true, level: 4 });

      const after = await call("get_character", { characterId });
      expect(after.data.summary).toContain("Lantern Bearer 3 / Herbalist 1");
      expect(after.data.tracks.levels).toEqual([
        { thing: "calling.lantern-bearer", name: "Lantern Bearer", levels: 3, fromLevel: 1, first: true },
        { thing: "calling.herbalist", name: "Herbalist", levels: 1, fromLevel: 4, added: true },
      ]);

      // Taken away while building and back: the answers stay.
      const open = await call("set_level", { characterId, level: 5 });
      expect(open.isError, JSON.stringify(open.data)).toBeFalsy();
      const single = await call("set_tracks", { characterId, tracks: [] });
      expect(single.isError, JSON.stringify(single.data)).toBeFalsy();
      const back = await call("set_tracks", {
        characterId,
        tracks: ["calling.lantern-bearer", "calling.lantern-bearer", "calling.herbalist"],
      });
      expect(back.isError, JSON.stringify(back.data)).toBeFalsy();
      const again = await call("get_character", { characterId });
      expect(again.data.answered.map((a: { choice: string }) => a.choice)).toContain(
        "talents-herbalist@calling.herbalist",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
