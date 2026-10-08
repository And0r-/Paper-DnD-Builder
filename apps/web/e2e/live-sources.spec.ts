/**
 * Where a change came from (AND-258), against the real server: the owner
 * on a phone, the game master of the campaign at a desk, a program with an
 * access key and a language model over /mcp. A change made elsewhere shows
 * without reloading, with a short line saying who made it and how; on the
 * sheet too. An unsaved change of this window survives a change to another
 * question; to the same question, the saved one counts and the line says
 * so. A second window of the same account is "another window".
 */
import type { APIRequestContext, Browser, Page, Route } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, makeCharacter, shot, signup, test } from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };
const ACCEPT = { accept: "application/json, text/event-stream" };

const card = (page: Page, thing: string) => page.locator(`[data-option="${thing}"]`);
const told = (page: Page) => page.locator("[data-told]");
const bar = (page: Page) => page.locator(".livebar");

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]!);
}
const line = (m: typeof de, from: string, what: string) => fill(m["live.told.line"], { from, what });

/** The game master in a browser of their own, English, at a desk. */
async function gameMasterBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: DESKTOP,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + 11) % 250}` },
  });
  return context.newPage();
}

/** Lio (owner, `page`) plays in Vexa's campaign; a level-3 character of Lio's in it. */
async function table(page: Page, gm: Page, lang: "de" | "en" = "de"): Promise<string> {
  await signup(gm, "Vexa", "en");
  const made = await gm.request.post("/api/campaigns", { data: { name: "Thursday" } });
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  await signup(page, "Lio", lang);
  const token = new URL(campaign.inviteUrl).pathname.split("/").at(-1)!;
  expect((await page.request.post(`/api/invites/${token}/join`)).status()).toBe(200);
  const r = await page.request.post("/api/drafts", {
    data: { packageId: "demo", level: 3, campaignId: campaign.id },
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { draft: { id: string } }).draft.id;
}

async function version(request: APIRequestContext, id: string): Promise<number> {
  return ((await (await request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } }).draft
    .version;
}

/** An access key of the account `page` is logged in with. */
async function accessKey(page: Page, baseURL: string): Promise<string> {
  const made = await page.request.post("/api/account/keys", {
    headers: { origin: new URL(baseURL).origin },
    data: { name: "Program" },
  });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { key: { secret: string } }).key.secret;
}

async function mcp(program: APIRequestContext, secret: string, name: string, args: object): Promise<void> {
  const r = await program.post("/mcp", {
    headers: { ...ACCEPT, authorization: `Bearer ${secret}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(r.status()).toBe(200);
  expect(((await r.json()) as { result: { isError?: boolean } }).result.isError ?? false).toBe(false);
}

test("the game master, a program with a key and MCP: each change shows at once and says where it came from", async ({
  page,
  browser,
  baseURL,
  playwright,
  foreign,
}) => {
  void foreign;
  const gm = await gameMasterBrowser(browser);
  const id = await table(page, gm);
  await page.goto(`/c/${id}/step/folk`);
  await gm.goto(`/c/${id}/step/folk`);
  await expect(card(page, "folk.hillfolk")).toBeVisible();
  await expect(bar(page)).toContainText(fill(de["live.person.gameMaster"], { name: "Vexa" }));

  // The game master picks: the owner's screen has it, and says who.
  await card(gm, "folk.hillfolk").click();
  await expect(card(page, "folk.hillfolk")).toHaveClass(/option--checked/);
  const byGm = fill(de["live.from.person"], { who: fill(de["live.person.gameMaster"], { name: "Vexa" }) });
  await expect(told(page)).toHaveText(line(de, byGm, "Herkunft"));
  await expectOneLanguage(page, "de");
  await shot(page, "258-spielleitung-handy-de");

  // A program of the owner's, with an access key.
  const secret = await accessKey(page, baseURL!);
  const program = await playwright.request.newContext({ baseURL: baseURL! });
  const byKey = await program.put(`/api/drafts/${id}/answers/folk`, {
    headers: { authorization: `Bearer ${secret}` },
    data: { version: await version(page.request, id), answer: { pick: "folk.moorfolk" } },
  });
  expect(byKey.status()).toBe(200);
  await expect(card(page, "folk.moorfolk")).toHaveClass(/option--checked/);
  await expect(told(page)).toHaveText(line(de, de["live.from.api"], "Herkunft"));
  await expect(card(gm, "folk.moorfolk")).toHaveClass(/option--checked/);
  await expect(told(gm)).toHaveText(line(en, fill(en["live.from.personApi"], { who: "Lio" }), "Folk"));
  await expectOneLanguage(gm, "en");
  await shot(gm, "258-program-desk-en");

  // The owner's language model over MCP, with the same key: first the answer, then the level.
  await mcp(program, secret, "set_answer", {
    characterId: id,
    choice: "folk",
    answer: { pick: "folk.coastfolk" },
  });
  await expect(card(page, "folk.coastfolk")).toHaveClass(/option--checked/);
  await expect(told(page)).toHaveText(line(de, de["live.from.mcp"], "Herkunft"));
  await mcp(program, secret, "set_level", { characterId: id, level: 4 });
  await expect(page.locator(".topbar__level")).toHaveText("Stufe 4");
  await expect(told(page)).toHaveText(line(de, de["live.from.mcp"], "Stufe"));
  await expect(gm.locator(".topbar__level")).toHaveText("Level 4");
  await expect(told(gm)).toHaveText(line(en, fill(en["live.from.personMcp"], { who: "Lio" }), "Level"));
  await shot(page, "258-mcp-handy-de");
  await program.dispose();

  // The owner deletes the character: the game master is sent to their list, which says why.
  expect((await page.request.delete(`/api/drafts/${id}`)).status()).toBe(204);
  await expect(gm).toHaveURL(/\/characters$/);
  await expect(gm.locator(".toast")).toHaveText(en["live.deleted"]);
  await gm.context().close();
});

test("a second window of the same account: “Changed in another window”", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Lio", "en");
  const r = await page.request.post("/api/drafts", { data: { packageId: "demo", level: 3 } });
  const id = ((await r.json()) as { draft: { id: string } }).draft.id;
  await page.goto(`/c/${id}/step/folk`);
  const second = await page.context().newPage();
  await second.goto(`/c/${id}/step/folk`);
  await expect(bar(page)).toContainText(en["live.person.window"]);

  await card(second, "folk.hillfolk").click();
  await expect(card(page, "folk.hillfolk")).toHaveClass(/option--checked/);
  await expect(told(page)).toHaveText(line(en, en["live.from.window"], "Folk"));
  // The window that made the change says nothing about it.
  await expect(told(second)).toHaveCount(0);
  await expectOneLanguage(page, "en");
  await shot(page, "258-other-window-phone-en");
  await second.close();
});

test("an unsaved change survives one to another question; to the same question the saved one counts", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await page.setViewportSize(DESKTOP);
  const gm = await gameMasterBrowser(browser);
  const id = await table(page, gm);
  await page.goto(`/c/${id}/step/folk`);
  await expect(card(page, "folk.hillfolk")).toBeVisible();

  // The owner's saves wait until the test lets them through.
  let release!: () => void;
  let held = new Promise<void>((r) => (release = r));
  await page.route("**/api/drafts/*/answers/folk", async (route: Route) => {
    await held;
    await route.fallback();
  });
  const gmAnswers = async (choice: string, answer: unknown) => {
    const r = await gm.request.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: await version(gm.request, id), answer },
    });
    expect(r.status()).toBe(200);
  };
  const byGm = fill(de["live.from.person"], { who: fill(de["live.person.gameMaster"], { name: "Vexa" }) });

  // Another question: the owner's pick stays and is saved after.
  await card(page, "folk.hillfolk").click();
  await expect(page.locator(".save-status")).toHaveText(de["save.saving"]);
  await gmAnswers("name", { text: "Brin" });
  await expect(told(page)).toHaveText(line(de, byGm, "Name"));
  await expect(card(page, "folk.hillfolk")).toHaveClass(/option--checked/);
  release();
  await expect(page.locator(".save-status")).toHaveText(de["save.saved"]);
  let stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { answers: Record<string, unknown> };
  };
  expect(stored.draft.answers["folk"]).toEqual({ pick: "folk.hillfolk" });
  expect(stored.draft.answers["name"]).toEqual({ text: "Brin" });

  // The same question: the game master's saved pick counts, and the line says so.
  held = new Promise<void>((r) => (release = r));
  await card(page, "folk.moorfolk").click();
  await expect(page.locator(".save-status")).toHaveText(de["save.saving"]);
  await gmAnswers("folk", { pick: "folk.coastfolk" });
  await expect(told(page)).toHaveText(fill(de["live.told.overruled"], { line: line(de, byGm, "Herkunft") }));
  await expect(card(page, "folk.coastfolk")).toHaveClass(/option--checked/);
  await expect(card(page, "folk.moorfolk")).not.toHaveClass(/option--checked/);
  await expectOneLanguage(page, "de");
  await shot(page, "258-gleiche-frage-desktop-de");
  release();
  await expect(page.locator(".save-status")).toHaveText(de["save.saved"]);
  stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as typeof stored;
  expect(stored.draft.answers["folk"]).toEqual({ pick: "folk.coastfolk" });
  await expect(card(page, "folk.coastfolk")).toHaveClass(/option--checked/);
  await gm.context().close();
});

for (const cut of [false, true])
  test(`back online after a while${cut ? ", the channel broken too" : ""}: the window sends only what it changed, the other's change stays (AND-270)`, async ({
    page,
    browser,
    foreign,
  }) => {
    void foreign;
    await offlineRound(page, browser, cut);
  });

/**
 * Lio is offline for a while; Vexa raises might, Lio lowers wit. With `cut`
 * the live channel breaks too and joins again after: then nobody can say
 * who made the change meanwhile.
 */
async function offlineRound(page: Page, browser: Browser, cut: boolean): Promise<void> {
  let broken = false;
  const sockets: { close(): Promise<void> }[] = [];
  await page.routeWebSocket(/\/api\/live\//, (ws) => {
    if (broken) return void ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  const gm = await gameMasterBrowser(browser);
  const id = await table(page, gm);
  const start = { mightBase: 8, graceBase: 8, witBase: 10, heartBase: 8 };
  const set = await page.request.put(`/api/drafts/${id}/answers/scores`, {
    data: { version: await version(page.request, id), answer: { method: 0, assign: start } },
  });
  expect(set.status()).toBe(200);
  const values = (p: Page) => p.locator(".stepper__value");
  // The rows: might, grace, wit, heart; each with "−" and "+".
  const step = (p: Page, row: number, button: 0 | 1) =>
    p.locator(".pointbuy__row").nth(row).locator(".stepper__btn").nth(button).click();
  await page.goto(`/c/${id}/step/scores`);
  await gm.goto(`/c/${id}/step/scores`);
  await expect(values(page)).toHaveText(["8", "8", "10", "8"]);
  await expect(bar(page)).toContainText(fill(de["live.person.gameMaster"], { name: "Vexa" }));

  // The owner has no network for a while. The game master raises might meanwhile,
  // the owner lowers wit.
  await page.context().setOffline(true);
  if (cut) {
    broken = true;
    await Promise.all(sockets.map((ws) => ws.close()));
  }
  await step(gm, 0, 1);
  await expect(values(gm)).toHaveText(["9", "8", "10", "8"]);
  await expect(gm.locator(".save-status")).toHaveText(en["save.saved"]);
  await step(page, 2, 0);
  await expect(values(page)).toHaveText(["8", "8", "9", "8"]);
  // A change over the live channel waits 10 seconds for its answer, then goes over HTTP, which fails.
  await expect(page.locator(".save-status")).toHaveText(de["save.offline"], { timeout: 30_000 });
  await shot(page, "270-offline-handy-de");

  // Back online: both screens hold both changes, and the owner's line says what happened.
  await page.context().setOffline(false);
  broken = false;
  // The channel tries again after up to 10 seconds.
  await expect(page.locator(".save-status")).toHaveText(de["save.saved"], { timeout: 30_000 });
  await expect(values(page)).toHaveText(["9", "8", "9", "8"]);
  await expect(values(gm)).toHaveText(["9", "8", "9", "8"]);
  // With the channel open it says who; after joining again nobody knows: "elsewhere".
  const byGm = fill(de["live.from.person"], { who: fill(de["live.person.gameMaster"], { name: "Vexa" }) });
  const from = cut ? de["live.from.unknown"] : byGm;
  await expect(told(page)).toHaveText(
    fill(de["live.told.alongside"], { line: line(de, from, "Grundwerte (Kraft 9)") }),
  );
  await expectOneLanguage(page, "de");
  await shot(page, `270-wieder-online${cut ? "-getrennt" : ""}-handy-de`);
  await shot(gm, `270-back-online${cut ? "-cut" : ""}-desk-en`);
  const stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { answers: Record<string, unknown> };
  };
  expect(stored.draft.answers["scores"]).toEqual({
    method: 0,
    assign: { ...start, mightBase: 9, witBase: 9 },
  });
  await gm.context().close();
}

test("the sheet follows the play state and the character, changed by a program, MCP and another window", async ({
  page,
  baseURL,
  playwright,
  foreign,
}) => {
  void foreign;
  await signup(page, "Lio");
  const id = await makeCharacter(page);
  const model = (await (await page.request.get(`/api/drafts/${id}/sheet`)).json()) as {
    sections: { boxes?: { label: string; style: string; field?: string }[] }[];
  };
  const pencil = model.sections.flatMap((s) => s.boxes ?? []).find((b) => b.style === "pencil" && b.field)!;
  await page.goto(`/c/${id}/bogen`);
  const field = page.getByRole("textbox", { name: pencil.label });
  await expect(field).toBeVisible();

  const secret = await accessKey(page, baseURL!);
  const program = await playwright.request.newContext({ baseURL: baseURL! });
  const putState = async (request: APIRequestContext, value: number, headers = {}) => {
    const now = (await (await request.get(`/api/drafts/${id}/state`, { headers })).json()) as {
      version: number;
      state: Record<string, unknown>;
    };
    const r = await request.put(`/api/drafts/${id}/state`, {
      headers,
      data: { version: now.version, state: { ...now.state, [pencil.field!]: value } },
    });
    expect(r.status()).toBe(200);
  };

  // The play state, written by a program with a key.
  await putState(program, 7, { authorization: `Bearer ${secret}` });
  await expect(field).toHaveValue("7");
  await expect(told(page)).toHaveText(line(de, de["live.from.api"], de["live.what.play"]));
  await expectOneLanguage(page, "de");
  await shot(page, "258-bogen-programm-handy-de");

  // The character, over MCP: the sheet is made from it and shows the new name.
  await mcp(program, secret, "set_answer", { characterId: id, choice: "name", answer: { text: "Oda" } });
  await expect(told(page)).toHaveText(line(de, de["live.from.mcp"], "Name"));
  await expect(page.locator(".sheet-screen").getByText("Oda").first()).toBeVisible();
  await program.dispose();

  // Another window of the same account.
  await putState(page.request, 9);
  await expect(field).toHaveValue("9");
  await expect(told(page)).toHaveText(line(de, de["live.from.window"], de["live.what.play"]));
});
