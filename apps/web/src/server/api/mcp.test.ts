/**
 * The tool list of @builder/mcp against this server with the demo package,
 * over the public API with nothing but an access key: a character built
 * from empty to finished, raised, printed; a withdrawn key; someone else's
 * character; a change made elsewhere in between.
 */
import { ApiClient, TOOLS, type ToolName, type ToolResult } from "@builder/mcp";
import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let owner: Client;

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server);
  await signIn(owner, server, "owner@example.org", "en");
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
  it("build a level-3 character from empty to finished, raise it to 5, and get its sheet", async () => {
    const call = toolsWith((await makeKey()).secret);

    const packages = await call("list_packages");
    expect(packages.data.map((p: { packageId: string }) => p.packageId)).toContain("demo");
    expect(packages.data.find((p: { packageId: string }) => p.packageId === "demo").name).toBeTruthy();

    const started = await call("start_character", { packageId: "demo", level: 3 });
    expect(started.isError).toBeFalsy();
    const characterId: string = started.data.characterId;
    expect(started.data).toMatchObject({ level: 3, state: "open", canFinish: false });
    expect(started.data.openChoices.length).toBeGreaterThan(0);

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
    expect(raised.data.newChoices.length).toBeGreaterThan(0);
    // Open now: the new choices, and older ones that ask for more at the higher level; nothing else.
    const openIds = raised.data.openChoices.map((c: { choice: string }) => c.choice);
    for (const c of raised.data.newChoices) expect(openIds).toContain(c.choice);
    const answeredAt5 = await answerAllOpen(call, characterId);
    // A copy (`<choice>@<pick>`) comes once the pick that brings it is answered.
    expect(answeredAt5.filter((id) => !id.includes("@"))).toEqual(openIds);
    const done = await call("finish_character", { characterId });
    expect(done.data).toMatchObject({ done: true, state: "finished", level: 5 });

    // Reading: values with names, what it has, answers in words.
    const character = await call("get_character", { characterId });
    expect(character.data).toMatchObject({ characterId, level: 5, state: "finished", name: "Mira Fennwick" });
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
  });

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
      expect(res.data.message).toMatch(/Settings/);
    }
  });

  it("does not see someone else's character", async () => {
    const other = new Client(server, "203.0.113.8");
    await signIn(other, server, "other@example.org");
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
