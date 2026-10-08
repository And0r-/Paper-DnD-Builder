import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
  await signIn(client, "player@example.org");
});

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

/** What a player who takes every recommendation would answer. */
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

describe("building a character over the API", () => {
  it("creates a level 3 character from the first step to the finished character", async () => {
    const list = await client.call("GET", "/api/packages");
    expect(list.json.packages).toEqual([
      expect.objectContaining({ id: "demo", language: "de", name: "Nebelland" }),
    ]);

    const created = await client.call("POST", "/api/drafts", { packageId: "demo", level: 3 });
    expect(created.status).toBe(201);
    const id: string = created.json.draft.id;
    let view = created.json;
    expect(view.draft).toMatchObject({ version: 1, level: 3, status: "draft", answers: {} });

    // Walk the steps in the order the server gives them, answering what is still open.
    const answered: string[] = [];
    for (let guard = 0; guard < 50 && !view.evaluation.complete; guard++) {
      const open = view.evaluation.steps
        .flatMap((s: { choices: string[] }) => s.choices)
        .map((c: string) => view.evaluation.choices[c] as ChoiceState)
        .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
      const res = await client.call("PUT", `/api/drafts/${id}/answers/${open.id}`, {
        version: view.draft.version,
        answer: answerFor(open),
      });
      expect(res.status, `${open.id}: ${JSON.stringify(res.json)}`).toBe(200);
      answered.push(open.id);
      view = res.json;
    }

    expect(answered).toEqual([
      "name",
      "calling",
      "folk",
      "upbringing",
      "path",
      "scores",
      "talents-lantern-bearer",
      "extra-talent",
      "knacks-lantern",
      "gear",
      "age",
    ]);
    expect(view.evaluation.complete).toBe(true);

    const finished = await client.call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version });
    expect(finished.status).toBe(200);
    expect(finished.json.draft).toMatchObject({ status: "finished", version: 13, level: 3 });
    expect(finished.json.evaluation.values).toMatchObject({ stamina: 18, guard: 9, pace: 25, luck: 2 });
    expect(finished.json.summary).toEqual({
      name: "Mira Fennwick",
      level: 3,
      complete: true,
      line: { calling: "calling.lantern-bearer", level: 3 },
    });

    const stored = await server.db.query<{ t: string }>("SELECT jsonb_typeof(document) AS t FROM drafts");
    expect(stored).toEqual([{ t: "object" }]);

    // The server is the only place the draft lives: a fresh read gives the same character.
    const read = await client.call("GET", `/api/drafts/${id}`);
    expect(read.json).toEqual(finished.json);
    const drafts = await client.call("GET", "/api/drafts");
    expect(drafts.json.drafts).toEqual([
      expect.objectContaining({ id, status: "finished", summary: finished.json.summary }),
    ]);
  });

  it("refuses to finish while something is open, and names what", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    const res = await client.call("POST", `/api/drafts/${created.json.draft.id}/finish`, { version: 1 });
    expect(res.status).toBe(422);
    expect(res.json.error).toEqual({
      code: "incomplete",
      open: ["name", "calling", "folk", "upbringing", "scores", "age"],
    });
  });

  it("refuses answers that do not fit, with the reason", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    const id = created.json.draft.id;
    const bad = await client.call("PUT", `/api/drafts/${id}/answers/folk`, {
      version: 1,
      answer: { pick: "calling.herbalist" },
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toEqual({
      code: "changeRejected",
      reason: { code: "answerDoesNotFit", problem: "notOffered" },
    });
    // Only a step with one shared list takes a list change.
    const pool = await client.call("PUT", `/api/drafts/${id}/pools/folk`, { version: 1, picks: [] });
    expect(pool.status).toBe(422);
    expect(pool.json.error.reason).toEqual({ code: "unknownStep" });
    const level = await client.call("PATCH", `/api/drafts/${id}`, { version: 1, level: 21 });
    expect(level.json.error.reason).toEqual({ code: "levelOutOfRange", min: 1, max: 20 });
    const unknownPackage = await client.call("POST", "/api/drafts", { packageId: "nope" });
    expect(unknownPackage.status).toBe(404);
  });

  it("refuses a change made on an old version and returns the current state (optimistic locking)", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    const id = created.json.draft.id;
    // Two tabs both start from version 1.
    const first = await client.call("PUT", `/api/drafts/${id}/answers/folk`, {
      version: 1,
      answer: { pick: "folk.hillfolk" },
    });
    expect(first.status).toBe(200);
    const second = await client.call("PUT", `/api/drafts/${id}/answers/folk`, {
      version: 1,
      answer: { pick: "folk.coastfolk" },
    });
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("versionConflict");
    expect(second.json.error.current.draft).toMatchObject({
      version: 2,
      answers: { folk: { pick: "folk.hillfolk" } },
    });
  });

  it("tells listeners about every stored change (the hook for live help)", async () => {
    const events: unknown[] = [];
    server.app.draftEvents.subscribe((e) => events.push(e));
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    const id = created.json.draft.id;
    await client.call("PATCH", `/api/drafts/${id}`, { version: 1, level: 2 });
    expect(events).toEqual([
      expect.objectContaining({ type: "created", draftId: id, version: 1 }),
      expect.objectContaining({ type: "changed", draftId: id, version: 2 }),
    ]);
  });

  it("makes a finished character a draft again when a change leaves something open", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo", level: 1 });
    const id = created.json.draft.id;
    let version = 1;
    for (const [choice, answer] of [
      ["folk", { pick: "folk.coastfolk" }],
      ["upbringing", { pick: "upbringing.bell-tower" }],
      ["calling", { pick: "calling.river-runner" }],
      ["talents-river-runner", { picks: ["talent.climbing", "talent.sneaking"] }],
      // Coastfolk add a talent of their own; the bell tower already taught listening.
      ["coastfolk-talent", { pick: "talent.weather-sense" }],
      // The bell tower gives "listening" already, so haggling is the only flair left.
      ["coastfolk-flair", { pick: "flair.haggling" }],
      ["gear", { pick: "item.fishing-net" }],
      ["handling-river-runner", { picks: ["handling.boat-hook", "handling.small-bell"] }],
      ["knacks-current", { picks: ["knack.fog-hop", "knack.eddy"] }],
      ["scores", { method: 1, assign: { mightBase: 9, graceBase: 11, witBase: 10, heartBase: 7 } }],
      // The bell tower adds +2 and +1 on top of the scores.
      ["bell-tower-gifts", { method: 0, assign: { mightGift: 2, witGift: 1, heartGift: 0 } }],
      ["name", { text: "Tobin" }],
      ["age", { value: 30 }],
    ] as const) {
      const r = await client.call("PUT", `/api/drafts/${id}/answers/${choice}`, { version, answer });
      expect(r.status, choice).toBe(200);
      version = r.json.draft.version;
    }
    const done = await client.call("POST", `/api/drafts/${id}/finish`, { version });
    expect(done.json.draft.status).toBe("finished");
    // Level 2 asks for one more talent and one more knack: the character is open again.
    const up = await client.call("PATCH", `/api/drafts/${id}`, {
      version: done.json.draft.version,
      level: 2,
    });
    expect(up.json.draft.status).toBe("draft");
    expect(up.json.evaluation.open).toEqual(["extra-talent", "knacks-current"]);
  });

  it("keeps drafts private to their account", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "someone-else@example.org");
    const read = await other.call("GET", `/api/drafts/${created.json.draft.id}`);
    expect(read.status).toBe(404);
    const del = await other.call("DELETE", `/api/drafts/${created.json.draft.id}`);
    expect(del.status).toBe(404);
    expect((await other.call("GET", "/api/drafts")).json.drafts).toEqual([]);
  });

  it("deletes a draft", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo" });
    expect((await client.call("DELETE", `/api/drafts/${created.json.draft.id}`)).status).toBe(204);
    expect((await client.call("GET", `/api/drafts/${created.json.draft.id}`)).status).toBe(404);
  });

  it("serves the package structure and the texts of exactly one language", async () => {
    const pkg = await client.call("GET", "/api/packages/demo");
    expect(pkg.json.package.flow.level).toEqual({ min: 1, max: 20, default: 1 });
    expect(pkg.json.package).not.toHaveProperty("texts");
    const de = await client.call("GET", "/api/packages/demo/texts/de");
    expect(de.json.texts["package.name"]).toBe("Nebelland");
    expect((await client.call("GET", "/api/packages/demo/texts/fr")).status).toBe(404);
    expect((await client.call("GET", "/api/packages/nope")).status).toBe(404);
  });
});
