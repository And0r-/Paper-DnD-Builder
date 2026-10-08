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
import { accessKey, expect, expectOneLanguage, makeCharacter, mcp, shot, signup, test } from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };

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
