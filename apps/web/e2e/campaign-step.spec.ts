/**
 * The campaign question before the first step (AND-231). A player in no
 * campaign never sees it. A player in campaigns gets one list, with the
 * campaign they joined last chosen, and can change it later on the
 * overview. A game master is a member of their own campaigns: the step
 * offers them too, and their characters show on the campaign page
 * (AND-234).
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, shot, signup, test, uniqueEmail } from "./helpers.ts";

/** A game master in a browser of their own, who makes a campaign and adds the player. */
async function invite(browser: Browser, name: string, player: string, language = "de"): Promise<string> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + name.length) % 250}` },
  });
  const page = await context.newPage();
  await signup(page, "leitung");
  const made = await page.request.post("/api/campaigns", { data: { name } });
  expect(made.status()).toBe(201);
  const id = ((await made.json()) as { campaign: { id: string } }).campaign.id;
  const added = await page.request.post(`/api/campaigns/${id}/players`, {
    data: { email: player, language },
  });
  expect(added.status()).toBe(201);
  await context.close();
  return id;
}

async function campaignOf(page: Page, draftId: string): Promise<string | null> {
  const view = (await (await page.request.get(`/api/drafts/${draftId}`)).json()) as {
    draft: { campaignId: string | null };
  };
  return view.draft.campaignId;
}

test("no campaign: the question is skipped", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "allein");
  await page.goto("/new");
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  expect(await campaignOf(page, draftId)).toBeNull();
});

test("in campaigns: the one joined last is chosen, and can be changed later", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  const player = uniqueEmail("spieler");
  await signup(page, "Robin", "de", player);
  const first = await invite(browser, "Montagsrunde", player);
  const last = await invite(browser, "Donnerstagsrunde", player);

  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  const field = page.getByLabel(m["new.campaignLabel"]);
  await expect(field).toHaveValue(last);
  await expect(field.locator("option")).toHaveText(["Donnerstagsrunde", "Montagsrunde", m["new.noCampaign"]]);
  await expectOneLanguage(page, "de");
  await shot(page, "94-kampagne-waehlen");

  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  expect(await campaignOf(page, draftId)).toBe(last);

  // Later, on the overview: another campaign, or none.
  await page.goto(`/c/${draftId}/overview`);
  const later = page.getByLabel(m["overview.campaign"]);
  await expect(later).toHaveValue(last);
  await later.selectOption(first);
  await expect.poll(() => campaignOf(page, draftId)).toBe(first);
  await later.selectOption({ label: m["new.noCampaign"] });
  await expect.poll(() => campaignOf(page, draftId)).toBeNull();
  await shot(page, "94-kampagne-uebersicht");

  // "No campaign" when making the next one.
  await page.goto("/new");
  await page.getByLabel(m["new.campaignLabel"]).selectOption({ label: m["new.noCampaign"] });
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const second = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  expect(await campaignOf(page, second)).toBeNull();
});

test("game master in no other campaign: their own one is chosen, and the character shows on its page", async ({
  page,
  foreign,
}) => {
  void foreign;
  const m = de;
  await signup(page, "leitet");
  const made = await page.request.post("/api/campaigns", { data: { name: "Nebelrunde" } });
  const id = ((await made.json()) as { campaign: { id: string } }).campaign.id;

  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByLabel(m["new.campaignLabel"])).toHaveValue(id);
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  expect(await campaignOf(page, draftId)).toBe(id);

  // On the campaign page, in a block of its own before the players.
  const named = await page.request.put(`/api/drafts/${draftId}/answers/name`, {
    data: { version: 1, answer: { text: "Tamsin" } },
  });
  expect(named.status()).toBe(200);
  await page.goto(`/campaigns/${id}`);
  const mine = page.getByRole("region", { name: m["campaign.mine"] });
  await expect(mine.getByRole("heading", { level: 3, name: "Tamsin" })).toBeVisible();
  await expect(page.locator(".campaign-page").getByRole("heading", { level: 2 })).toHaveText([
    m["campaign.mine"],
    m["campaign.players"],
    m["campaign.delete"],
  ]);
  await expectOneLanguage(page, "de");
  await shot(page, "94-kampagne-eigene-charaktere");
});

test("leads one, joined another later: the one joined later is chosen", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  const player = uniqueEmail("beides");
  await signup(page, "Robin", "de", player);
  const made = await page.request.post("/api/campaigns", { data: { name: "Eigene Runde" } });
  expect(made.status()).toBe(201);
  const joined = await invite(browser, "Spätere Runde", player);

  await page.goto("/new");
  const field = page.getByLabel(m["new.campaignLabel"]);
  await expect(field).toHaveValue(joined);
  await expect(field.locator("option")).toHaveText(["Spätere Runde", "Eigene Runde", m["new.noCampaign"]]);
});

test("en: the campaign question in English only", async ({ page, browser, foreign }) => {
  void foreign;
  const m = en;
  const player = uniqueEmail("player-en");
  await signup(page, "Robin", "en", player);
  const id = await invite(browser, "Thursday group", player, "en");
  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByLabel(m["new.campaignLabel"])).toHaveValue(id);
  await expectOneLanguage(page, "en");
  await shot(page, "94-campaign-choose-en");
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
});
