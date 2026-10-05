/**
 * Raising a finished character over the API: the new level, what it adds,
 * the character's state on the way, and the refusals.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
  await signIn(client, server, "player@example.org");
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = any;

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

/** Answers what is open, in step order; returns the last view and the choices answered. */
async function answerOpen(view: View): Promise<{ view: View; answered: string[] }> {
  const id: string = view.draft.id;
  const answered: string[] = [];
  for (let guard = 0; guard < 80 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((c: string) => view.evaluation.choices[c] as ChoiceState)
      .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    const res = await client.call("PUT", `/api/drafts/${id}/answers/${encodeURIComponent(open.id)}`, {
      version: view.draft.version,
      answer: answerFor(open),
    });
    expect(res.status, `${open.id}: ${JSON.stringify(res.json)}`).toBe(200);
    answered.push(open.id);
    view = res.json;
  }
  return { view, answered };
}

async function finished(level: number): Promise<View> {
  const created = (await client.call("POST", "/api/drafts", { packageId: "demo", level })).json;
  const { view } = await answerOpen(created);
  const done = await client.call("POST", `/api/drafts/${view.draft.id}/finish`, {
    version: view.draft.version,
  });
  expect(done.status).toBe(200);
  return done.json;
}

const levelUp = (view: View, level: number) =>
  client.call("POST", `/api/drafts/${view.draft.id}/level-up`, { version: view.draft.version, level });

describe("raising a finished character", () => {
  it("raises 1 → 2 → 3: draft again with only the new things open, finished again after them", async () => {
    const l1 = await finished(1);
    expect(l1.draft).toMatchObject({ status: "finished", level: 1, levelBefore: null });
    expect(l1.levelUp).toBeNull();

    const up = await levelUp(l1, 2);
    expect(up.status).toBe(200);
    expect(up.json.draft).toMatchObject({
      status: "draft",
      level: 2,
      levelBefore: 1,
      finishedAt: null,
      answers: l1.draft.answers,
    });
    expect(up.json.levelUp).toEqual({
      from: 1,
      to: 2,
      newSteps: [],
      newChoices: ["extra-talent"],
      openSteps: ["talents", "knacks"],
    });
    expect(up.json.evaluation.open).toEqual(["extra-talent", "knacks-lantern"]);
    expect(up.json.evaluation.values).toMatchObject({ stamina: 13, practice: 2, lanternSlots1: 2 });

    // Not finished while something is open, and not printable either.
    const early = await client.call("POST", `/api/drafts/${l1.draft.id}/finish`, {
      version: up.json.draft.version,
    });
    expect(early.status).toBe(422);
    expect(early.json.error).toEqual({ code: "incomplete", open: ["extra-talent", "knacks-lantern"] });
    expect((await client.call("GET", `/api/drafts/${l1.draft.id}/pdf`)).status).toBe(409);

    const { view, answered } = await answerOpen(up.json);
    expect(answered).toEqual(["extra-talent", "knacks-lantern"]);
    // Complete, but the raise lasts until the player finishes.
    expect(view.draft).toMatchObject({ status: "draft", levelBefore: 1 });
    const done = await client.call("POST", `/api/drafts/${l1.draft.id}/finish`, {
      version: view.draft.version,
    });
    expect(done.json.draft).toMatchObject({ status: "finished", level: 2, levelBefore: null });
    expect(done.json.levelUp).toBeNull();
    const stored = await server.db.query<{ document: object }>("SELECT document FROM drafts");
    expect(stored[0]!.document).not.toHaveProperty("levelBefore");

    const to3 = await levelUp(done.json, 3);
    expect(to3.json.draft).toMatchObject({ status: "draft", level: 3, levelBefore: 2 });
    expect(to3.json.levelUp).toMatchObject({ from: 2, newSteps: ["path"], openSteps: ["path"] });
  });

  it("finishes at once when the new level asks nothing, and still says what the raise was", async () => {
    const l4 = await finished(4);
    const up = await levelUp(l4, 5);
    expect(up.status).toBe(200);
    expect(up.json.draft).toMatchObject({ status: "finished", level: 5, levelBefore: null });
    expect(up.json.draft.finishedAt).not.toBeNull();
    expect(up.json.levelUp).toEqual({ from: 4, to: 5, newSteps: [], newChoices: [], openSteps: [] });
    expect(up.json.evaluation.values.practice).toBe(3);
    expect((await client.request("GET", `/api/drafts/${l4.draft.id}/pdf`)).status).toBe(200);
    // A fresh read is an ordinary finished character.
    expect((await client.call("GET", `/api/drafts/${l4.draft.id}`)).json.levelUp).toBeNull();
  });

  it("raises 1 → 20 in one go and may go higher again before finishing", async () => {
    const l1 = await finished(1);
    const to5 = await levelUp(l1, 5);
    expect(to5.json.draft).toMatchObject({ status: "draft", levelBefore: 1 });
    const to20 = await levelUp(to5.json, 20);
    expect(to20.status).toBe(200);
    expect(to20.json.draft).toMatchObject({ status: "draft", level: 20, levelBefore: 1 });
    expect(to20.json.levelUp.newSteps).toEqual([
      "path",
      "lantern-vow",
      "boon-4",
      "boon-8",
      "boon-12",
      "boon-16",
      "boon-19",
    ]);
    const { view } = await answerOpen(to20.json);
    const done = await client.call("POST", `/api/drafts/${l1.draft.id}/finish`, {
      version: view.draft.version,
    });
    expect(done.json.draft).toMatchObject({ status: "finished", level: 20 });
    expect(done.json.evaluation.values).toMatchObject({ practice: 6, knackRank: 5, lanternSlots9: 2 });
    expect((await client.request("GET", `/api/drafts/${l1.draft.id}/pdf`)).status).toBe(200);
  });

  it("refuses a level that is not higher, above the highest, and a character not finished", async () => {
    const l3 = await finished(3);
    const same = await levelUp(l3, 3);
    expect(same.status).toBe(422);
    expect(same.json.error).toEqual({ code: "changeRejected", reason: { code: "levelNotHigher", level: 3 } });
    const lower = await levelUp(l3, 1);
    expect(lower.json.error.reason).toEqual({ code: "levelNotHigher", level: 3 });
    const tooHigh = await levelUp(l3, 21);
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.json.error.reason).toEqual({ code: "levelOutOfRange", min: 1, max: 20 });
    const stale = await client.call("POST", `/api/drafts/${l3.draft.id}/level-up`, { version: 1, level: 5 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("versionConflict");
    // Nothing of that changed the character.
    expect((await client.call("GET", `/api/drafts/${l3.draft.id}`)).json.draft).toMatchObject({
      status: "finished",
      level: 3,
      version: l3.draft.version,
    });

    const draft = (await client.call("POST", "/api/drafts", { packageId: "demo" })).json;
    const notFinished = await levelUp(draft, 2);
    expect(notFinished.status).toBe(409);
    expect(notFinished.json.error).toEqual({
      code: "notFinished",
      open: ["name", "calling", "folk", "upbringing", "scores", "age"],
    });
    const bad = await client.call("POST", `/api/drafts/${l3.draft.id}/level-up`, {
      version: l3.draft.version,
      level: "5",
    });
    expect(bad.status).toBe(400);
  });

  it("ends the raise when the level is set back to where it started", async () => {
    const l2 = await finished(2);
    const up = await levelUp(l2, 3);
    const back = await client.call("PATCH", `/api/drafts/${l2.draft.id}`, {
      version: up.json.draft.version,
      level: 2,
    });
    expect(back.json.draft).toMatchObject({ level: 2, levelBefore: null, status: "draft" });
    expect(back.json.levelUp).toBeNull();
    expect(back.json.evaluation.complete).toBe(true);
  });
});
