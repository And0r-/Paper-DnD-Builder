/**
 * GET /api/drafts/:id/explain/:value and the screen give the same parts.
 * The screen does not ask the route: it works the explanation out in the
 * browser (it also explains numbers a player is still moving, before they
 * are saved). So this checks that both come from the same function on the
 * same data: the package and the draft as the screen loads them over the API.
 */
import { evaluateDraft, explainValue, type DraftDocument } from "@builder/core";
import type { ContentPackage } from "@builder/format";
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
  step: string;
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

/** A level 3 demo character with every recommendation taken. */
async function builtCharacter(): Promise<string> {
  let view = (await client.call("POST", "/api/drafts", { packageId: "demo", level: 3 })).json;
  const id: string = view.draft.id;
  for (let guard = 0; view.evaluation.open.length > 0; guard++) {
    if (guard > 80) throw new Error("does not end");
    const choice: ChoiceState = view.evaluation.choices[view.evaluation.open[0]];
    const step = view.evaluation.steps.find((s: { id: string }) => s.id === choice.step);
    const res = step.pool
      ? await client.call("PUT", `/api/drafts/${id}/pools/${step.id}`, {
          version: view.draft.version,
          picks: step.pool.recommended,
        })
      : await client.call("PUT", `/api/drafts/${id}/answers/${encodeURIComponent(choice.id)}`, {
          version: view.draft.version,
          answer: answerFor(choice),
        });
    expect(res.status, choice.id).toBe(200);
    view = res.json;
  }
  return id;
}

describe("GET /api/drafts/:id/explain/:value", () => {
  it("names the parts and their sources of a level 3 character", async () => {
    const id = await builtCharacter();
    const res = await client.call("GET", `/api/drafts/${id}/explain/grace`);
    expect(res.status).toBe(200);
    // The base handed out in the scores choice, and the bonus the upbringing gives.
    expect(res.json).toEqual({
      value: "grace",
      total: 8,
      parts: [
        { amount: 7, source: { kind: "choice", choice: "scores" } },
        { amount: 1, source: { kind: "thing", thing: "upbringing.ferry-child" } },
      ],
    });
    // A value worked out from another names that value and the start.
    const bonus = await client.call("GET", `/api/drafts/${id}/explain/graceBonus`);
    expect(bonus.json.parts).toEqual([
      { amount: 2, source: { kind: "values", values: ["grace"] } },
      { amount: -2, source: { kind: "start" } },
    ]);
  });

  it("gives what the screen works out, for every value of the character", async () => {
    const id = await builtCharacter();
    // The package and the draft as the screen loads them.
    const structure = (await client.call("GET", "/api/packages/demo")).json.package;
    const pkg: ContentPackage = { ...structure, texts: {}, textOrigins: {} };
    const { draft } = (await client.call("GET", `/api/drafts/${id}`)).json;
    const doc: DraftDocument = { level: draft.level, answers: draft.answers };
    const ev = evaluateDraft(pkg, doc);

    const kinds = new Set<string>();
    for (const v of Object.keys(ev.values)) {
      const res = await client.call("GET", `/api/drafts/${id}/explain/${encodeURIComponent(v)}`);
      expect(res.status, v).toBe(200);
      const screen = explainValue(pkg, ev, v);
      expect(res.json, v).toEqual({ value: v, total: ev.values[v], parts: screen?.parts ?? null });
      for (const p of screen?.parts ?? []) kinds.add(p.source.kind);
    }
    // The character is built far enough that every kind of source a sheet shows turns up.
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["choice", "start", "thing", "values"]));
  });

  it("answers 404 for a value the package does not have, and for someone else's character", async () => {
    const id = await builtCharacter();
    for (const v of ["nothing", "constructor", "__proto__"]) {
      const res = await client.call("GET", `/api/drafts/${id}/explain/${v}`);
      expect(res.status, v).toBe(404);
      expect(res.json.error.code).toBe("valueNotFound");
    }
    const other = new Client(server, "198.51.100.30");
    await signIn(other, "other@example.org");
    const theirs = await other.call("GET", `/api/drafts/${id}/explain/might`);
    expect(theirs.status).toBe(404);
    expect(theirs.json.error.code).toBe("draftNotFound");
    const anonymous = await new Client(server, "198.51.100.31").call(
      "GET",
      `/api/drafts/${id}/explain/might`,
    );
    expect(anonymous.status).toBe(401);
  });
});
