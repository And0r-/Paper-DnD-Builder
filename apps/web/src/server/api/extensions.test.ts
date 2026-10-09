/**
 * Extensions over the API (SPEC 17): a character has them on unless it
 * names none, switches them on and off, sees their options only while on,
 * and a character without them is exactly what it was before extensions
 * existed; one with them on but nothing taken from them has the same sheet.
 */
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { switchOnExtensionsOnce } from "../app.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;
let demoAlone: string;

beforeAll(async () => {
  // The demo package as it was before extensions: without its extensions folder.
  demoAlone = await mkdtemp(path.join(tmpdir(), "demo-alone-"));
  await cp(DEMO_PACKAGE_DIR, demoAlone, {
    recursive: true,
    filter: (src) =>
      !src.includes("node_modules") && !src.startsWith(path.join(DEMO_PACKAGE_DIR, "extensions")),
  });
});
afterAll(() => rm(demoAlone, { recursive: true, force: true }));

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

/* eslint-disable @typescript-eslint/no-explicit-any -- API answers are walked as JSON */
type View = any;

function answerFor(c: ChoiceState, picks: Record<string, string>): unknown {
  if (picks[c.id]) return { pick: picks[c.id] };
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

async function answer(c: Client, view: View, choice: string, a: unknown): Promise<View> {
  const res = await c.call("PUT", `/api/drafts/${view.draft.id}/answers/${choice}`, {
    version: view.draft.version,
    answer: a,
  });
  expect(res.status, `${choice}: ${JSON.stringify(res.json)}`).toBe(200);
  return res.json;
}

/** A river runner at level 3, every other answer as recommended, finished. */
async function build(c: Client, body: object, picks: Record<string, string> = {}): Promise<View> {
  const created = await c.call("POST", "/api/drafts", { packageId: "demo", level: 3, ...body });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  let view = created.json;
  const all = { calling: "calling.river-runner", ...picks };
  for (let guard = 0; guard < 50 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((id: string) => view.evaluation.choices[id] as ChoiceState)
      .find((s: ChoiceState) => !s.optional && s.status !== "answered" && s.status !== "info")!;
    view = await answer(c, view, open.id, answerFor(open, all));
  }
  const finished = await c.call("POST", `/api/drafts/${view.draft.id}/finish`, {
    version: view.draft.version,
  });
  expect(finished.status).toBe(200);
  return finished.json;
}

describe("extensions", () => {
  it("are listed with their package, with dependsOn and publishable", async () => {
    const res = await client.call("GET", "/api/packages?lang=en");
    expect(res.json.packages[0].extensions).toEqual([
      {
        id: "demo-tides",
        version: "0.2.0",
        languages: ["en", "de"],
        dependsOn: [{ id: "demo", minVersion: "0.18.0" }],
        publishable: false,
        name: "Tides of Mistland",
        short: expect.any(String),
      },
    ]);
  });

  it("are all on for a new character that names none, with their options", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo", level: 3 });
    expect(created.json.draft.extensions).toEqual(["demo-tides"]);
    const view = await answer(client, created.json, "calling", { pick: "calling.river-runner" });
    expect(view.evaluation.choices["path"].options).toEqual(["path.ferrymaster", "path.tide-warden"]);
  });

  it("are off for a new character asked with an empty list, whose options leave them out", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo", level: 3, extensions: [] });
    expect(created.json.draft.extensions).toEqual([]);
    const view = await answer(client, created.json, "calling", { pick: "calling.river-runner" });
    expect(view.evaluation.choices["path"].options).toEqual(["path.ferrymaster"]);
  });

  it("are all on for a character a game master makes for a player, unless named", async () => {
    const gm = new Client(server, "203.0.113.1");
    await signIn(gm, "gm@example.org");
    const campaignId = (await gm.call("POST", "/api/campaigns", { name: "Mistland" })).json.campaign.id;
    const url: string = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json.campaign.inviteUrl;
    const joined = await client.call("POST", `/api/invites/${url.split("/join/")[1]}/join`);
    expect(joined.status, JSON.stringify(joined.json)).toBe(200);
    const playerId = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json.players[0].id;
    const path_ = `/api/campaigns/${campaignId}/players/${playerId}/drafts`;
    const all = await gm.call("POST", path_, { packageId: "demo" });
    expect(all.status, JSON.stringify(all.json)).toBe(201);
    expect(all.json.draft.extensions).toEqual(["demo-tides"]);
    const none = await gm.call("POST", path_, { packageId: "demo", extensions: [] });
    expect(none.json.draft.extensions).toEqual([]);
  });

  it("are switched on once for every character from before", async () => {
    const off = (await client.call("POST", "/api/drafts", { packageId: "demo", extensions: [] })).json;
    const done = await build(client, { extensions: [] });
    await switchOnExtensionsOnce(server.app);
    const after = (await client.call("GET", `/api/drafts/${off.draft.id}`)).json;
    expect(after.draft.extensions).toEqual(["demo-tides"]);
    expect(after.draft.version).toBe(off.draft.version + 1);
    expect(after.draft.answers).toEqual(off.draft.answers);
    const finished = (await client.call("GET", `/api/drafts/${done.draft.id}`)).json;
    expect(finished.draft.extensions).toEqual(["demo-tides"]);
    expect(finished.draft.status).toBe("finished");
    expect(finished.draft.answers).toEqual(done.draft.answers);

    // Once: a character switched off afterwards stays off at the next start.
    const offAgain = await client.call("PATCH", `/api/drafts/${off.draft.id}`, {
      version: after.draft.version,
      extensions: [],
    });
    expect(offAgain.status).toBe(200);
    await switchOnExtensionsOnce(server.app);
    expect((await client.call("GET", `/api/drafts/${off.draft.id}`)).json.draft.extensions).toEqual([]);
  });

  it("add their options once switched on, and stay on while an answer comes from them", async () => {
    let view = (await client.call("POST", "/api/drafts", { packageId: "demo", level: 3, extensions: [] }))
      .json;
    view = await answer(client, view, "calling", { pick: "calling.river-runner" });
    const on = await client.call("PATCH", `/api/drafts/${view.draft.id}`, {
      version: view.draft.version,
      extensions: ["demo-tides"],
    });
    expect(on.status).toBe(200);
    expect(on.json.draft.extensions).toEqual(["demo-tides"]);
    expect(on.json.evaluation.choices["path"].options).toEqual(["path.ferrymaster", "path.tide-warden"]);

    view = await answer(client, on.json, "path", { pick: "path.tide-warden" });
    expect(view.evaluation.things.map((t: { id: string }) => t.id)).toContain("talent.tide-reading");
    const refused = await client.call("PATCH", `/api/drafts/${view.draft.id}`, {
      version: view.draft.version,
      extensions: [],
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toEqual({
      code: "extensionInUse",
      extension: "demo-tides",
      choices: ["path"],
    });

    view = await answer(client, view, "path", { pick: "path.ferrymaster" });
    const off = await client.call("PATCH", `/api/drafts/${view.draft.id}`, {
      version: view.draft.version,
      extensions: [],
    });
    expect(off.status).toBe(200);
    expect(off.json.draft.extensions).toEqual([]);
    expect(off.json.evaluation.choices["path"].options).toEqual(["path.ferrymaster"]);
  });

  it("refuses an extension the package does not have", async () => {
    const created = await client.call("POST", "/api/drafts", { packageId: "demo", extensions: ["nothing"] });
    expect(created.status).toBe(404);
    expect(created.json.error).toEqual({ code: "extensionNotFound", extension: "nothing" });
    const view = (await client.call("POST", "/api/drafts", { packageId: "demo" })).json;
    const patched = await client.call("PATCH", `/api/drafts/${view.draft.id}`, {
      version: view.draft.version,
      extensions: ["nothing"],
    });
    expect(patched.status).toBe(404);
  });

  it("serve the package with them, and mark texts from the fallback language", async () => {
    const structure = await client.call("GET", "/api/packages/demo+demo-tides");
    expect(structure.json.package.extensions.map((x: { id: string }) => x.id)).toEqual(["demo-tides"]);
    expect((await client.call("GET", "/api/packages/demo")).json.package.extensions).toEqual([]);
    const de = await client.call("GET", "/api/packages/demo+demo-tides/texts/de");
    expect(de.json.fallbacks).toEqual({ "path.tide-warden.rules": "en" });
    expect(de.json.texts["path.tide-warden.name"]).toBe("Gezeitenwächter");
    expect((await client.call("GET", "/api/packages/demo/texts/de")).json.fallbacks).toEqual({});
    expect((await client.call("GET", "/api/packages/demo+nothing")).status).toBe(404);
  });

  it("print a line on the sheet when the character has content from an unpublishable extension", async () => {
    const withIt = await build(client, {}, { path: "path.tide-warden" });
    const sheet = await client.call("GET", `/api/drafts/${withIt.draft.id}/sheet`);
    expect(sheet.json.attribution).toMatch(/ Enthält Inhalt aus Gezeiten im Nebelland\.$/);
    expect(sheet.json.attribution).not.toContain("Weitergabe");

    // Switched on, but nothing taken from it: nothing to say.
    const onOnly = await build(client, {}, { path: "path.ferrymaster" });
    const plain = await client.call("GET", `/api/drafts/${onOnly.draft.id}/sheet`);
    expect(plain.json.attribution).not.toContain("Enthält");
  });

  it("leave a character without them exactly as before extensions", async () => {
    // Both share the database: the second start empties it, so both sign up after it.
    const before = await startTestServer({ packagesDir: demoAlone });
    const old = new Client(before);
    await signIn(old, "player@example.com");
    await signIn(client, "player@example.org");
    const a = await build(old, {});
    const b = await build(client, { extensions: [] });
    const sheetOf = async (c: Client, id: string) => (await c.call("GET", `/api/drafts/${id}/sheet`)).json;
    expect(await sheetOf(client, b.draft.id)).toEqual(await sheetOf(old, a.draft.id));
    const { id: _a, ...va } = a.draft;
    const { id: _b, ...vb } = b.draft;
    expect(vb).toEqual(va);
    expect(b.evaluation).toEqual(a.evaluation);

    // On by default, nothing taken from it: no line about the extension, and the same sheet but
    // for what the extension adds to every character: a talent row in the table of all talents
    // (not had, not marked) and its value. The draft differs only in its extensions.
    const c = await build(client, {});
    expect(c.draft.extensions).toEqual(["demo-tides"]);
    const added = new Set(["talent.tide-reading", "tideReadingRoll"]);
    const without = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.filter((e) => !added.has(e?.id)).map(without)
        : x && typeof x === "object"
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, without(v)]))
          : x;
    const onSheet = await sheetOf(client, c.draft.id);
    const beforeSheet = await sheetOf(old, a.draft.id);
    expect(onSheet.attribution).toBe(beforeSheet.attribution);
    expect(without(onSheet)).toEqual(without(beforeSheet));
    const talents = onSheet.sections.find((x: { id: string }) => x.id === "talents");
    expect(talents.items).toContainEqual(
      expect.objectContaining({ id: "talent.tide-reading", marked: false, strong: false }),
    );
    const { id: _c, extensions: _x, ...vc } = c.draft;
    const { extensions: _y, ...va2 } = va;
    expect(vc).toEqual(va2);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
