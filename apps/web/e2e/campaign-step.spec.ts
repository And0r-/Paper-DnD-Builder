/**
 * The campaign question before the first step (AND-231). A player in no
 * campaign never sees it. A player in campaigns gets one list, with the
 * campaign they joined last chosen, and can change it later on the
 * overview.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

/** A game master in a browser of their own, who makes a campaign and adds the player. */
async function invite(browser: Browser, name: string, player: string, language = "de"): Promise<string> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + name.length) % 250}` },
  });
  const page = await context.newPage();
  await login(page, uniqueEmail("leitung"));
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
  await login(page, uniqueEmail("allein"));
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
  const first = await invite(browser, "Montagsrunde", player);
  const last = await invite(browser, "Donnerstagsrunde", player);

  await login(page, player);
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

test("en: the campaign question in English only", async ({ page, browser, foreign }) => {
  void foreign;
  const m = en;
  const player = uniqueEmail("player-en");
  const id = await invite(browser, "Thursday group", player, "en");
  await login(page, player, "en");
  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByLabel(m["new.campaignLabel"])).toHaveValue(id);
  await expectOneLanguage(page, "en");
  await shot(page, "94-campaign-choose-en");
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
});
