/**
 * Kept copies of the sheet and the play state over the API: versions and
 * conflicts, who may reach them (owner, game master, access key, nobody
 * else), the limits, the shape check, and that neither follows the
 * character: a raise leaves every copy as it was and the play state where
 * it was. Deleting the character takes both along.
 */
import { sheetModelSchema } from "@builder/sheet";
import { beforeEach, describe, expect, it } from "vitest";
import { Client, passwordFromMail, signIn, startTestServer, type TestServer } from "../testing.ts";
import { MAX_COPIES_PER_CHARACTER, MAX_COPY_BYTES } from "./routes/sheet-copies.ts";

let server: TestServer;
let gm: Client;
let player: Client;
let stranger: Client;
let id: string;

const PLAYER = "player@example.org";

beforeEach(async () => {
  server = await startTestServer();
  gm = new Client(server, "203.0.113.1");
  player = new Client(server, "203.0.113.2");
  stranger = new Client(server, "203.0.113.3");
  await signIn(gm, server, "lead@example.org");
  await signIn(stranger, server, "stranger@example.org");
  const campaign = (await gm.call("POST", "/api/campaigns", { name: "Die Nebelrunde" })).json.campaign;
  await gm.call("POST", `/api/campaigns/${campaign.id}/players`, { email: PLAYER, language: "de" });
  const password = passwordFromMail(server.mails, PLAYER);
  expect((await player.call("POST", "/api/auth/login", { email: PLAYER, password })).status).toBe(200);
  id = (await finished(3)).draft.id;
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

async function answerOpen(view: View): Promise<View> {
  for (let guard = 0; guard < 80 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((c: string) => view.evaluation.choices[c] as ChoiceState)
      .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    const res = await player.call(
      "PUT",
      `/api/drafts/${view.draft.id}/answers/${encodeURIComponent(open.id)}`,
      { version: view.draft.version, answer: answerFor(open) },
    );
    expect(res.status, `${open.id}: ${JSON.stringify(res.json)}`).toBe(200);
    view = res.json;
  }
  return view;
}

async function finished(level: number): Promise<View> {
  const created = (await player.call("POST", "/api/drafts", { packageId: "demo", level })).json;
  const view = await answerOpen(created);
  const done = await player.call("POST", `/api/drafts/${view.draft.id}/finish`, {
    version: view.draft.version,
  });
  expect(done.status).toBe(200);
  return done.json;
}

/** Raises the character and stops while the raise still has open choices; returns the view. */
async function raise(level: number): Promise<View> {
  const now = (await player.call("GET", `/api/drafts/${id}`)).json;
  const up = await player.call("POST", `/api/drafts/${id}/level-up`, { version: now.draft.version, level });
  expect(up.status, JSON.stringify(up.json)).toBe(200);
  return up.json;
}

async function finishRaise(view: View): Promise<View> {
  view = await answerOpen(view);
  const done = await player.call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version });
  expect(done.status).toBe(200);
  return done.json;
}

const base = () => `/api/drafts/${id}`;
const newCopy = async (c: Client = player, body: object = {}) => {
  const res = await c.call("POST", `${base()}/sheet-copies`, body);
  expect(res.status, JSON.stringify(res.json).slice(0, 300)).toBe(201);
  return res.json;
};

describe("kept copies of the sheet", () => {
  it("copies the original as it is now, named by date in the account's language", async () => {
    const original = (await player.call("GET", `${base()}/sheet`)).json;
    const draft = (await player.call("GET", base())).json.draft;
    expect(original.origin).toMatchObject({ kind: "original", level: 3, changedAt: draft.updatedAt });

    const made = await newCopy();
    expect(made.copy).toMatchObject({
      name: "Meine Fassung vom 4. Oktober 2026",
      fromLevel: 3,
      fromChangedAt: draft.updatedAt,
      fromPackageVersion: original.origin.packageVersion,
      language: "de",
      version: 1,
    });
    expect(made.model.origin).toEqual({
      kind: "copy",
      name: "Meine Fassung vom 4. Oktober 2026",
      createdAt: made.copy.createdAt,
      fromLevel: 3,
      fromPackageVersion: original.origin.packageVersion,
      fromChangedAt: draft.updatedAt,
    });
    // Apart from its origin, the copy is the original; the original's numbers and what follows
    // from them (`values`) stay with the original, so a changed number is not told twice.
    expect(original.values.length).toBeGreaterThan(0);
    expect(made.model.values).toEqual([]);
    const { origin: _a, values: _c, ...copyRest } = made.model;
    const { origin: _b, values: _d, ...originalRest } = original;
    expect(copyRest).toEqual(originalRest);
    expect(sheetModelSchema.safeParse(made.model).success).toBe(true);

    // The list has no models; the read has one.
    const list = await player.call("GET", `${base()}/sheet-copies`);
    expect(list.status).toBe(200);
    expect(list.json.copies).toEqual([made.copy]);
    expect(list.json.original).toEqual({
      level: 3,
      changedAt: draft.updatedAt,
      packageVersion: original.origin.packageVersion,
      finished: true,
    });
    expect((await player.call("GET", `${base()}/sheet-copies/${made.copy.id}`)).json).toEqual(made);

    // In English, an English name.
    await player.call("PATCH", "/api/account/settings", { language: "en" });
    expect((await newCopy()).copy.name).toBe("My version of October 4, 2026");
    expect((await newCopy(player, { name: "Mit Marcs Hausregeln" })).copy.name).toBe("Mit Marcs Hausregeln");
  });

  it("makes a copy with its first change in one request, unless the original moved on", async () => {
    const original = (await player.call("GET", `${base()}/sheet`)).json;
    const changed = { ...original, name: "Mira die Kühne" };
    const made = await newCopy(player, { model: changed });
    expect(made.model.name).toBe("Mira die Kühne");
    expect(made.model.values).toEqual([]);
    expect(made.copy.fromLevel).toBe(3);

    // The original changed (a raise) since the viewer loaded it: refused, nothing made.
    await finishRaise(await raise(4));
    const stale = await player.call("POST", `${base()}/sheet-copies`, { model: changed });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: "originalChanged", original: { level: 4 } });
    expect((await player.call("GET", `${base()}/sheet-copies`)).json.copies).toHaveLength(1);
  });

  it("changes name and model with the version it was read at; a stale one is refused", async () => {
    const made = await newCopy();
    const url = `${base()}/sheet-copies/${made.copy.id}`;
    // A model sent with the original's `values` is kept without them.
    const { values } = (await player.call("GET", `${base()}/sheet`)).json;
    const model = { ...made.model, name: "Mira die Kühne", values };

    const renamed = await player.call("PUT", url, { version: 1, name: "Mit Hausregeln" });
    expect(renamed.status).toBe(200);
    expect(renamed.json.copy).toMatchObject({ name: "Mit Hausregeln", version: 2 });
    expect(renamed.json.model.origin.name).toBe("Mit Hausregeln");

    // Another tab still at version 1.
    const stale = await player.call("PUT", url, { version: 1, model });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("versionConflict");
    expect(stale.json.error.current.copy).toMatchObject({ name: "Mit Hausregeln", version: 2 });

    const both = await player.call("PUT", url, { version: 2, model, name: "Neu" });
    expect(both.status).toBe(200);
    expect(both.json.model).toMatchObject({ name: "Mira die Kühne", origin: { kind: "copy", name: "Neu" } });
    expect(both.json.model.values).toEqual([]);
    expect(both.json.copy.version).toBe(3);
    expect((await player.call("GET", url)).json).toEqual(both.json);

    // Nothing to change is a bad request, not a new version.
    expect((await player.call("PUT", url, { version: 3 })).status).toBe(400);
  });

  it("checks the model against the sheet schema", async () => {
    const made = await newCopy();
    const url = `${base()}/sheet-copies/${made.copy.id}`;
    for (const bad of [
      { ...made.model, version: 2 },
      { ...made.model, extra: true },
      { ...made.model, sections: [{ id: "x", kind: "nothing", span: 1, title: "", hint: "" }] },
      { ...made.model, level: "drei" },
    ]) {
      const res = await player.call("PUT", url, { version: 1, model: bad });
      expect(res.status, JSON.stringify(bad).slice(0, 100)).toBe(400);
      expect(res.json.error.code).toBe("badRequest");
    }
    expect((await player.call("POST", `${base()}/sheet-copies`, { model: { name: "x" } })).status).toBe(400);
    expect((await player.call("GET", url)).json.copy.version).toBe(1);
  });

  it("keeps at most fifty copies per character", async () => {
    for (let i = 0; i < MAX_COPIES_PER_CHARACTER; i++) await newCopy();
    const eleventh = await player.call("POST", `${base()}/sheet-copies`, {});
    expect(eleventh.status).toBe(409);
    expect(eleventh.json.error).toEqual({ code: "tooManyCopies", max: MAX_COPIES_PER_CHARACTER });

    // Deleting one makes room again; another character has its own fifty.
    const list = (await player.call("GET", `${base()}/sheet-copies`)).json.copies;
    expect((await player.call("DELETE", `${base()}/sheet-copies/${list[0].id}`)).status).toBe(204);
    await newCopy();
    const other = (await finished(1)).draft.id;
    expect((await player.call("POST", `/api/drafts/${other}/sheet-copies`, {})).status).toBe(201);
  });

  it("keeps a model up to 512 KiB", async () => {
    const made = await newCopy();
    const url = `${base()}/sheet-copies/${made.copy.id}`;
    const size = (m: unknown) => Buffer.byteLength(JSON.stringify(m));
    const padded = (bytes: number) => ({
      ...made.model,
      attribution: made.model.attribution + "x".repeat(bytes - size(made.model)),
    });

    const largest = padded(MAX_COPY_BYTES);
    expect(size(largest)).toBe(MAX_COPY_BYTES);
    const ok = await player.call("PUT", url, { version: 1, model: largest });
    expect(ok.status).toBe(200);

    const over = await player.call("PUT", url, { version: 2, model: padded(MAX_COPY_BYTES + 1) });
    expect(over.status).toBe(413);
    expect(over.json.error).toEqual({ code: "copyTooLarge", max: MAX_COPY_BYTES });

    // A body far beyond is refused before it is read as JSON.
    const huge = await player.call("PUT", url, { version: 2, model: padded(2 * MAX_COPY_BYTES) });
    expect(huge.status).toBe(413);
    expect(huge.json.error.code).toBe("bodyTooLarge");
    expect((await player.call("GET", url)).json.copy.version).toBe(2);
  });

  it("deletes a copy; a missing or deleted one is 404", async () => {
    const made = await newCopy();
    const url = `${base()}/sheet-copies/${made.copy.id}`;
    expect((await player.call("DELETE", url)).status).toBe(204);
    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", { version: 1, name: "x" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await player.call(method, url, body);
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe("copyNotFound");
    }
    expect((await player.call("GET", `${base()}/sheet-copies/not-a-uuid`)).status).toBe(404);
  });

  it("remembers per account the version opened last; a new copy is opened", async () => {
    const list = async (c: Client) => (await c.call("GET", `${base()}/sheet-copies`)).json;
    expect(await list(player)).toMatchObject({ opened: null, max: MAX_COPIES_PER_CHARACTER });
    const first = await newCopy();
    expect((await list(player)).opened).toBe(first.copy.id);
    // The game master looks at the same character on their own.
    expect((await list(gm)).opened).toBe(null);

    const view = (body: object, c: Client = player) => c.call("PUT", `${base()}/sheet-view`, body);
    expect((await view({ copyId: null })).json).toEqual({ opened: null });
    expect((await list(player)).opened).toBe(null);
    expect((await view({ copyId: first.copy.id }, gm)).status).toBe(200);
    expect((await list(gm)).opened).toBe(first.copy.id);
    expect((await list(player)).opened).toBe(null);

    // Only a copy of this character; a deleted one falls back to the original.
    const other = (await finished(1)).draft.id;
    const elsewhere = (await player.call("POST", `/api/drafts/${other}/sheet-copies`, {})).json.copy.id;
    expect((await view({ copyId: elsewhere })).json.error.code).toBe("copyNotFound");
    expect((await view({ copyId: "not-a-uuid" })).status).toBe(404);
    expect((await view({})).status).toBe(400);
    expect((await view({ copyId: first.copy.id }, stranger)).status).toBe(404);
    expect((await player.call("DELETE", `${base()}/sheet-copies/${first.copy.id}`)).status).toBe(204);
    expect((await list(gm)).opened).toBe(null);
  });

  it("opens the original instead of an older copy once the original changed", async () => {
    const list = async () => (await player.call("GET", `${base()}/sheet-copies`)).json;
    const made = await newCopy();
    server.advance(60_000);
    // Level 3 to 4 after the copy was made: the sheet opens the original at level 4.
    await finishRaise(await raise(4));
    const now = await list();
    expect(now.original.level).toBe(4);
    expect(now.copies).toHaveLength(1);
    expect(now.opened).toBe(null);
    expect((await player.call("GET", `${base()}/sheet`)).json.origin.level).toBe(4);

    // Picked again on purpose, the copy opens again; until the original changes once more.
    server.advance(60_000);
    await player.call("PUT", `${base()}/sheet-view`, { copyId: made.copy.id });
    expect((await list()).opened).toBe(made.copy.id);
    server.advance(60_000);
    await finishRaise(await raise(5));
    expect((await list()).opened).toBe(null);

    // A copy of the original as it is now stays the one opened.
    server.advance(60_000);
    const fresh = await newCopy();
    expect((await list()).opened).toBe(fresh.copy.id);
  });

  it("refuses a copy of a character that is not finished", async () => {
    const draft = (await player.call("POST", "/api/drafts", { packageId: "demo" })).json.draft;
    const res = await player.call("POST", `/api/drafts/${draft.id}/sheet-copies`, {});
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("notFinished");
  });
});

describe("nothing follows the character", () => {
  it("leaves a copy exactly as it was through a raise and a change of language", async () => {
    const made = await newCopy();
    const url = `${base()}/sheet-copies/${made.copy.id}`;
    const before = await (await player.request("GET", url)).text();
    await player.call("PUT", `${base()}/state`, { version: 0, state: { "sheet/primary/stamina": 7 } });

    // While the raise is open, the character is a draft again: copies and
    // play state are still there and readable, only a new copy waits.
    server.advance(60_000);
    const raising = await raise(20);
    expect(raising.draft.status).toBe("draft");
    expect(await (await player.request("GET", url)).text()).toBe(before);
    expect((await player.call("POST", `${base()}/sheet-copies`, {})).json.error.code).toBe("notFinished");
    expect((await player.call("GET", `${base()}/sheet-copies`)).json.original).toMatchObject({
      level: 20,
      finished: false,
    });

    await finishRaise(raising);
    await player.call("PATCH", "/api/account/settings", { language: "en" });
    expect(await (await player.request("GET", url)).text()).toBe(before);

    // The original moved on; the stamps say so without comparing models.
    const original = (await player.call("GET", `${base()}/sheet`)).json;
    expect(original).toMatchObject({ language: "en", level: 20, origin: { kind: "original", level: 20 } });
    expect(original.origin.changedAt).not.toBe(made.copy.fromChangedAt);
    const list = (await player.call("GET", `${base()}/sheet-copies`)).json;
    expect(list.copies[0]).toMatchObject({ fromLevel: 3, language: "de" });
    expect(list.original).toMatchObject({ level: 20, changedAt: original.origin.changedAt, finished: true });

    // The play state is where it was, for the original and for the copy alike.
    expect((await player.call("GET", `${base()}/state`)).json.state).toEqual({ "sheet/primary/stamina": 7 });
  });

  it("goes with the character when it is deleted", async () => {
    await newCopy();
    await newCopy();
    await player.call("PUT", `${base()}/state`, { version: 0, state: { "sheet/primary/stamina": 7 } });
    const count = async (table: string) =>
      (
        await server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE draft_id = $1`, [
          id,
        ])
      )[0]!.n;
    expect(await count("sheet_copies")).toBe(2);
    expect(await count("character_states")).toBe(1);

    expect((await player.call("DELETE", base())).status).toBe(204);
    expect(await count("sheet_copies")).toBe(0);
    expect(await count("character_states")).toBe(0);
  });
});

describe("play state", () => {
  it("starts empty at version 0 and moves on with every write; a stale write is refused", async () => {
    expect((await player.call("GET", `${base()}/state`)).json).toEqual({
      state: {},
      version: 0,
      updatedAt: null,
    });

    const state = {
      "sheet/primary/stamina": 12,
      "sheet/notes/notes": "Schuldet Tobi 3 Münzen",
      "cards/x/uses": { checks: 2 },
    };
    const first = await player.call("PUT", `${base()}/state`, { version: 0, state });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ state, version: 1 });

    // A second device that still had version 0.
    const stale = await player.call("PUT", `${base()}/state`, { version: 0, state: {} });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: "versionConflict", current: { state, version: 1 } });

    const second = await player.call("PUT", `${base()}/state`, {
      version: 1,
      state: { "sheet/primary/stamina": 9 },
    });
    expect(second.json).toMatchObject({ state: { "sheet/primary/stamina": 9 }, version: 2 });
    expect((await player.call("GET", `${base()}/state`)).json).toEqual(second.json);
  });

  it("clearChecks rubs out every tick and nothing else", async () => {
    await player.call("PUT", `${base()}/state`, {
      version: 0,
      state: {
        "sheet/primary/stamina": 12,
        "sheet/notes/notes": "3 Münzen",
        "cards/a/uses": { checks: 2 },
        "sheet/features/b/uses": { checks: 1 },
      },
    });
    const rest = await player.call("PUT", `${base()}/state`, { version: 1, clearChecks: true });
    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({
      state: { "sheet/primary/stamina": 12, "sheet/notes/notes": "3 Münzen" },
      version: 2,
    });
    expect((await player.call("PUT", `${base()}/state`, { version: 1, clearChecks: true })).status).toBe(409);
  });

  it("takes numbers, texts and counts of ticks only", async () => {
    for (const state of [
      { a: true },
      { a: null },
      { a: { checks: -1 } },
      { a: { checks: 1.5 } },
      { a: { checks: 1, more: 1 } },
      { "": 1 },
      { a: [1] },
    ]) {
      expect(
        (await player.call("PUT", `${base()}/state`, { version: 0, state })).status,
        JSON.stringify(state),
      ).toBe(400);
    }
    expect((await player.call("PUT", `${base()}/state`, { version: 0, clearChecks: false })).status).toBe(
      400,
    );
  });
});

describe("who may reach copies and play state", () => {
  it("the owner, the game master and an access key may; anyone else gets 404", async () => {
    // The game master makes, changes and deletes a copy of the player's character, and writes the state.
    const fromGm = await newCopy(gm);
    const url = `${base()}/sheet-copies/${fromGm.copy.id}`;
    expect((await gm.call("PUT", url, { version: 1, name: "Auslegung der Spielleitung" })).status).toBe(200);
    expect((await player.call("GET", url)).json.copy.name).toBe("Auslegung der Spielleitung");
    expect((await gm.call("PUT", `${base()}/state`, { version: 0, state: { a: 1 } })).status).toBe(200);
    expect((await player.call("GET", `${base()}/state`)).json.state).toEqual({ a: 1 });

    // An access key of the player.
    const key = (await player.call("POST", "/api/account/keys", {})).json.key.secret as string;
    const k = { authorization: `Bearer ${key}` };
    const tool = new Client(server, "203.0.113.9");
    expect((await tool.call("GET", `${base()}/sheet-copies`, undefined, k)).json.copies).toHaveLength(1);
    expect((await tool.call("PUT", url, { version: 2, name: "Vom Werkzeug" }, k)).status).toBe(200);
    expect((await tool.call("PUT", `${base()}/state`, { version: 1, clearChecks: true }, k)).status).toBe(
      200,
    );
    expect((await tool.call("POST", `${base()}/sheet-copies`, {}, k)).status).toBe(201);

    // Someone else: every route looks like a missing character.
    for (const [method, path, body] of [
      ["GET", `${base()}/sheet-copies`, undefined],
      ["POST", `${base()}/sheet-copies`, {}],
      ["GET", url, undefined],
      ["PUT", url, { version: 3, name: "Fremd" }],
      ["DELETE", url, undefined],
      ["GET", `${base()}/state`, undefined],
      ["PUT", `${base()}/state`, { version: 2, state: {} }],
    ] as const) {
      const res = await stranger.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.json.error.code).toBe("draftNotFound");
      expect((await new Client(server, "203.0.113.4").call(method, path, body)).status).toBe(401);
    }

    // The game master may delete a copy, too.
    expect((await gm.call("DELETE", url)).status).toBe(204);
    expect((await player.call("GET", `${base()}/sheet-copies`)).json.copies).toHaveLength(1);
  });

  it("a game master's copy is in the game master's language, and stays the player's character's", async () => {
    await gm.call("PATCH", "/api/account/settings", { language: "en" });
    const made = await newCopy(gm);
    expect(made.copy).toMatchObject({ language: "en", name: "My version of October 4, 2026" });
    expect(made.model.language).toBe("en");
    expect((await player.call("GET", `${base()}/sheet-copies`)).json.copies).toHaveLength(1);
  });
});
