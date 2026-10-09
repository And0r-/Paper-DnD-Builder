/**
 * Another package for an existing character (`PUT /api/drafts/:id/package`):
 * every answer goes, level and campaign stay, the new package's extensions
 * are on unless named. Two packages: the demo package with its extension,
 * and a copy of it under another id without one, standing in for another
 * edition of a game.
 */
import { ApiClient, TOOLS } from "@builder/mcp";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let root: string;
let server: TestServer;
let player: Client;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "two-packages-"));
  const skip = (src: string) => !src.includes("node_modules");
  await cp(DEMO_PACKAGE_DIR, path.join(root, "demo"), { recursive: true, filter: skip });
  const other = path.join(root, "other");
  await cp(DEMO_PACKAGE_DIR, other, {
    recursive: true,
    filter: (src) => skip(src) && !src.startsWith(path.join(DEMO_PACKAGE_DIR, "extensions")),
  });
  const manifest = path.join(other, "manifest.json");
  const m = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(manifest, JSON.stringify({ ...m, id: "other", version: "1.0.0" }));
});
afterAll(() => rm(root, { recursive: true, force: true }));

beforeEach(async () => {
  server = await startTestServer({ packagesDir: root });
  player = new Client(server);
  await signIn(player, "player@example.org");
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

/** A level-5 river runner on the extension's path, every other answer as recommended, finished. */
async function build(c: Client): Promise<View> {
  const created = await c.call("POST", "/api/drafts", {
    packageId: "demo",
    level: 5,
    extensions: ["demo-tides"],
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  let view = created.json;
  const picks = { calling: "calling.river-runner", path: "path.tide-warden" };
  for (let guard = 0; guard < 80 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((id: string) => view.evaluation.choices[id] as ChoiceState)
      .find((s: ChoiceState) => !s.optional && s.status !== "answered" && s.status !== "info")!;
    const res = await c.call("PUT", `/api/drafts/${view.draft.id}/answers/${open.id}`, {
      version: view.draft.version,
      answer: answerFor(open, picks),
    });
    expect(res.status, `${open.id}: ${JSON.stringify(res.json)}`).toBe(200);
    view = res.json;
  }
  const finished = await c.call("POST", `/api/drafts/${view.draft.id}/finish`, {
    version: view.draft.version,
  });
  expect(finished.status).toBe(200);
  return finished.json;
}

const switchTo = (c: Client, view: View, body: object, query = "") =>
  c.call("PUT", `/api/drafts/${view.draft.id}/package${query}`, { version: view.draft.version, ...body });

/** A new draft of `packageId` at `level`, as `POST /api/drafts` makes it. */
async function fresh(packageId: string, level: number, extensions?: string[]): Promise<View> {
  const res = await player.call("POST", "/api/drafts", {
    packageId,
    level,
    ...(extensions ? { extensions } : {}),
  });
  return res.json;
}

describe("another package for a character", () => {
  it("drops every answer and keeps level and campaign, there and back", async () => {
    const campaign = (await player.call("POST", "/api/campaigns", { name: "Thursday" })).json.campaign;
    let view = await build(player);
    view = (await player.call("PUT", `/api/drafts/${view.draft.id}/campaign`, { campaignId: campaign.id }))
      .json;
    expect(view.draft).toMatchObject({ status: "finished", level: 5, extensions: ["demo-tides"] });
    expect(view.draft.answers["path"]).toEqual({ pick: "path.tide-warden" });
    expect(view.draft.answers["name"]).toEqual({ text: "Mira Fennwick" });
    expect(view.draft.tracks).toEqual([]);

    const away = await switchTo(player, view, { packageId: "other" });
    expect(away.status, JSON.stringify(away.json)).toBe(200);
    expect(away.json.draft).toMatchObject({
      id: view.draft.id,
      packageId: "other",
      packageVersion: "1.0.0",
      extensions: [],
      version: view.draft.version + 1,
      status: "draft",
      finishedAt: null,
      level: 5,
      levelBefore: null,
      campaignId: campaign.id,
      answers: {},
      tracks: [],
      access: "owner",
    });
    // Exactly what a new character of that package at that level is.
    const otherNew = await fresh("other", 5);
    expect(away.json.evaluation).toEqual(otherNew.evaluation);
    expect(away.json.summary).toEqual(otherNew.summary);

    // Back: every extension of the package is on again, and nothing of before returns.
    const back = await switchTo(player, away.json, { packageId: "demo" });
    expect(back.status).toBe(200);
    expect(back.json.draft).toMatchObject({
      packageId: "demo",
      extensions: ["demo-tides"],
      status: "draft",
      level: 5,
      campaignId: campaign.id,
      answers: {},
    });
    expect(back.json.evaluation).toEqual((await fresh("demo", 5, ["demo-tides"])).evaluation);

    // Named extensions count, also none.
    const away2 = await switchTo(player, back.json, { packageId: "other" });
    const plain = await switchTo(player, away2.json, { packageId: "demo", extensions: [] });
    expect(plain.json.draft.extensions).toEqual([]);

    // Stored so: read again, the draft is the same.
    const read = await player.call("GET", `/api/drafts/${view.draft.id}`);
    expect(read.json).toEqual(plain.json);
  });

  it("changes nothing for the package it already has", async () => {
    const view = await build(player);
    const same = await switchTo(player, view, { packageId: "demo", extensions: [] });
    expect(same.status).toBe(200);
    expect(same.json).toEqual(view);
  });

  it("refuses an unknown package, an extension of another package and an old version", async () => {
    const view = await build(player);
    const unknown = await switchTo(player, view, { packageId: "nothing" });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe("packageNotFound");

    const foreign = await switchTo(player, view, { packageId: "other", extensions: ["demo-tides"] });
    expect(foreign.status).toBe(404);
    expect(foreign.json.error).toEqual({ code: "extensionNotFound", extension: "demo-tides" });

    const stale = await player.call("PUT", `/api/drafts/${view.draft.id}/package`, {
      version: view.draft.version - 1,
      packageId: "other",
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("versionConflict");
    expect(stale.json.error.current).toEqual(view);
  });

  it("is the owner's and their game master's; someone else and a help link do not reach it", async () => {
    const view = await build(player);
    const stranger = new Client(server);
    await signIn(stranger, "stranger@example.org");
    const theirs = await switchTo(stranger, view, { packageId: "other" });
    expect(theirs.status).toBe(404);
    expect(theirs.json.error.code).toBe("draftNotFound");

    const link = await player.call("POST", `/api/drafts/${view.draft.id}/help-link`);
    const token = link.json.helpLink.token;
    expect((await stranger.call("GET", `/api/drafts/${view.draft.id}?help=${token}`)).status).toBe(200);
    const helped = await switchTo(stranger, view, { packageId: "other" }, `?help=${token}`);
    expect(helped.status).toBe(404);

    // The game master of the character's campaign builds it with another package.
    const gm = new Client(server);
    await signIn(gm, "gm@example.org");
    const campaign = (await gm.call("POST", "/api/campaigns", { name: "Friday" })).json.campaign;
    const inviteToken = new URL(campaign.inviteUrl).pathname.split("/").at(-1);
    expect((await player.call("POST", `/api/invites/${inviteToken}/join`)).status).toBe(200);
    const inCampaign = (
      await player.call("PUT", `/api/drafts/${view.draft.id}/campaign`, { campaignId: campaign.id })
    ).json;
    const byGm = await switchTo(gm, inCampaign, { packageId: "other" });
    expect(byGm.status, JSON.stringify(byGm.json)).toBe(200);
    expect(byGm.json.draft).toMatchObject({ packageId: "other", access: "gameMaster", answers: {} });
    // Still the player's: it stays in their list.
    const list = (await player.call("GET", "/api/drafts")).json.drafts;
    expect(list.map((d: { id: string; packageId: string }) => [d.id, d.packageId])).toEqual([
      [view.draft.id, "other"],
    ]);
  });

  it("keeps the character's sheet copies", async () => {
    const view = await build(player);
    const kept = await player.call("POST", `/api/drafts/${view.draft.id}/sheet-copies`, { name: "Before" });
    expect(kept.status, JSON.stringify(kept.json)).toBe(201);
    await switchTo(player, view, { packageId: "other" });
    const copies = await player.call("GET", `/api/drafts/${view.draft.id}/sheet-copies`);
    expect(copies.json.copies.map((c: { name: string }) => c.name)).toEqual(["Before"]);
    const copy = await player.call(
      "GET",
      `/api/drafts/${view.draft.id}/sheet-copies/${kept.json.copy.id as string}`,
    );
    expect(copy.status).toBe(200);
  });

  it("works over MCP with switch_package", async () => {
    const view = await build(player);
    const key = (await player.call("POST", "/api/account/keys", { name: "Language model" })).json.key;
    const client = new ApiClient({
      baseUrl: "http://builder.test",
      key: key.secret,
      fetch: (input, init) => server.fetch(new Request(input, init)),
    });
    const tool = TOOLS.find((t) => t.name === "switch_package")!;
    const result = await tool.run(client, { characterId: view.draft.id, packageId: "other" });
    expect(result.isError).toBeFalsy();
    expect(result.data).toMatchObject({ done: true, level: 5 });
    const read = await player.call("GET", `/api/drafts/${view.draft.id}`);
    expect(read.json.draft).toMatchObject({ packageId: "other", answers: {} });
  });
});
