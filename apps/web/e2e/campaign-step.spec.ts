/**
 * The step "Campaign", first in the step list (AND-231, AND-333). A player
 * in no campaign never sees it. A player in campaigns starts there, with
 * the campaign they joined last chosen, and can change it on the step at
 * any time, also to "no campaign"; the overview names it in a line that
 * leads to the step. A game master is a member of their own campaigns: the
 * step offers them too, and their characters show on the campaign page
 * (AND-234). Building for a player, the game master sees the step to look
 * at only.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import AxeBuilder from "@axe-core/playwright";
import { expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };

async function noAxeViolations(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

const draftOf = (page: Page) => /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;

/**
 * A game master in a browser of their own makes a campaign; the player
 * joins with its invitation link (AND-237). Returns the campaign's id.
 */
async function invite(browser: Browser, name: string, player: Page): Promise<string> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + name.length) % 250}` },
  });
  const page = await context.newPage();
  await signup(page, "leitung");
  const made = await page.request.post("/api/campaigns", { data: { name } });
  expect(made.status()).toBe(201);
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  await context.close();
  const token = campaign.inviteUrl.split("/join/")[1]!;
  const joined = await player.request.post(`/api/invites/${token}/join`);
  expect(joined.status()).toBe(200);
  return campaign.id;
}

async function campaignOf(page: Page, draftId: string): Promise<string | null> {
  const view = (await (await page.request.get(`/api/drafts/${draftId}`)).json()) as {
    draft: { campaignId: string | null };
  };
  return view.draft.campaignId;
}

test("no campaign: there is no such step", async ({ page, foreign }) => {
  void foreign;
  const m = de;
  await signup(page, "allein");
  await page.goto("/new");
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = draftOf(page);
  expect(await campaignOf(page, draftId)).toBeNull();
  await page.setViewportSize(DESKTOP);
  const list = page.getByRole("navigation", { name: m["flow.steps"] });
  await expect(list.getByRole("link", { name: new RegExp(`^${m["new.campaignLabel"]}`) })).toHaveCount(0);
  await expect(page.locator(".progress__text")).toContainText(
    m["flow.progress"].replace("{current}", "1").replace(/ \S+ \{total\}/, ""),
  );
  await page.goto(`/c/${draftId}/campaign`);
  await expect(page.getByText(m["flow.stepNotFound"])).toBeVisible();
});

test("in campaigns: the first step, the one joined last chosen, changeable at any time", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  await signup(page, "Robin", "de");
  const first = await invite(browser, "Montagsrunde", page);
  const last = await invite(browser, "Donnerstagsrunde", page);

  await page.goto("/new");
  await page.waitForURL(/\/c\/[0-9a-f-]+\/campaign$/);
  const draftId = draftOf(page);
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByText(m["new.campaignIntro"])).toBeVisible();
  const field = page.getByLabel(m["new.campaignLabel"], { exact: true });
  await expect(field).toHaveValue(last);
  await expect(field.locator("option")).toHaveText(["Donnerstagsrunde", "Montagsrunde", m["new.noCampaign"]]);
  expect(await campaignOf(page, draftId)).toBe(last);
  await expect(page.locator(".progress__text")).toContainText(
    m["flow.progress"].replace("{current}", "1").replace(/ \S+ \{total\}/, ""),
  );
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "94-kampagne-waehlen");

  // Changed on the step, saved at once; "no campaign" is an answer too.
  await field.selectOption(first);
  await expect.poll(() => campaignOf(page, draftId)).toBe(first);
  await field.selectOption({ label: m["new.noCampaign"] });
  await expect.poll(() => campaignOf(page, draftId)).toBeNull();

  // The step list, wide: "Campaign" first, done either way; Back from the level leads to it.
  await page.setViewportSize(DESKTOP);
  const list = page.getByRole("navigation", { name: m["flow.steps"] });
  const step = list.getByRole("link", { name: new RegExp(`^${m["new.campaignLabel"]}`) });
  await expect(step).toHaveAttribute("aria-current", "step");
  await expect(list.getByRole("link").first()).toHaveAttribute("href", `/c/${draftId}/campaign`);
  await shot(page, "94-kampagne-schritt-desktop");
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(new RegExp(`/c/${draftId}/level$`));
  await expect(step).toHaveClass(/steplist__link--done/);
  await page.getByRole("link", { name: m["common.back"] }).click();
  await page.waitForURL(new RegExp(`/c/${draftId}/campaign$`));
  await field.selectOption(first);
  await expect.poll(() => campaignOf(page, draftId)).toBe(first);

  // The overview: one line that leads to the step, no second field.
  await page.goto(`/c/${draftId}/overview`);
  const line = page.locator(".summary__item").filter({
    has: page.getByRole("heading", { level: 2, name: m["new.campaignLabel"], exact: true }),
  });
  await expect(line.locator(".summary__line")).toHaveText("Montagsrunde");
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveCount(0);
  await shot(page, "94-kampagne-uebersicht");
  await line
    .getByRole("link", { name: m["overview.changeLabel"].replace("{step}", m["new.campaignLabel"]) })
    .click();
  await page.waitForURL(new RegExp(`/c/${draftId}/campaign\\?from=overview$`));
  await page.getByLabel(m["new.campaignLabel"], { exact: true }).selectOption({ label: m["new.noCampaign"] });
  await expect.poll(() => campaignOf(page, draftId)).toBeNull();
  await page.getByRole("link", { name: m["flow.backToOverview"] }).click();
  await expect(line.locator(".summary__line")).toHaveText(m["new.noCampaign"]);
  // Never open: "No campaign" does not hold anything up.
  await expect(page.getByText(m["overview.openTitle"])).toBeVisible();
  await expect(page.locator(".callout").filter({ hasText: m["overview.openTitle"] })).not.toContainText(
    m["new.campaignLabel"],
  );
});

test("from the invitation: the step is answered, and says once where one plays now", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  await signup(page, "Robin", "de");
  const invited = await invite(browser, "Montagsrunde", page);
  await invite(browser, "Donnerstagsrunde", page);

  await page.goto(`/new?campaign=${invited}&joined`);
  await page.waitForURL(/\/c\/[0-9a-f-]+\/campaign$/);
  const draftId = draftOf(page);
  expect(await campaignOf(page, draftId)).toBe(invited);
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveValue(invited);
  await expect(
    page.getByRole("status").filter({ hasText: m["new.joined"].replace("{name}", "Montagsrunde") }),
  ).toBeVisible();
  await shot(page, "94-einladung-kampagne-gewaehlt");
  await page.reload();
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveValue(invited);
  await expect(page.getByText(m["new.joined"].replace("{name}", "Montagsrunde"))).toHaveCount(0);
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
  await page.waitForURL(/\/c\/[0-9a-f-]+\/campaign$/);
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveValue(id);
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = draftOf(page);
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
    m["campaign.inviteTitle"],
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
  await signup(page, "Robin", "de");
  const made = await page.request.post("/api/campaigns", { data: { name: "Eigene Runde" } });
  expect(made.status()).toBe(201);
  const joined = await invite(browser, "Spätere Runde", page);

  await page.goto("/new");
  await page.waitForURL(/\/c\/[0-9a-f-]+\/campaign$/);
  const field = page.getByLabel(m["new.campaignLabel"], { exact: true });
  await expect(field).toHaveValue(joined);
  await expect(field.locator("option")).toHaveText(["Spätere Runde", "Eigene Runde", m["new.noCampaign"]]);
});

test("game master building for a player: the step is there to look at only", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  await signup(page, "Kim", "de");
  const gmContext = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + 99) % 250}` },
  });
  const gm = await gmContext.newPage();
  await signup(gm, "Sam");
  const made = await gm.request.post("/api/campaigns", { data: { name: "Sams Runde" } });
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  const token = campaign.inviteUrl.split("/join/")[1]!;
  expect((await page.request.post(`/api/invites/${token}/join`)).status()).toBe(200);
  const players = (await (await gm.request.get(`/api/campaigns/${campaign.id}`)).json()) as {
    players: { id: string; name: string }[];
  };
  const kim = players.players.find((p) => p.name === "Kim")!;

  await gm.goto(`/new?campaign=${campaign.id}&player=${kim.id}`);
  await gm.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = draftOf(gm);
  await gm.goto(`/c/${draftId}/campaign`);
  await expect(gm.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(gm.getByText(m["new.forPlayer"].replace("{name}", "Kim"))).toBeVisible();
  await expect(gm.locator(".campaign-step__answer dd")).toHaveText("Sams Runde");
  await expect(gm.getByText(m["new.campaignOwnerOnly"].replace("{name}", "Kim"))).toBeVisible();
  await expect(gm.locator(".step").getByRole("combobox")).toHaveCount(0);
  await expectOneLanguage(gm, "de");
  await noAxeViolations(gm);
  await shot(gm, "94-kampagne-fuer-spieler");
  expect(
    (await gm.request.put(`/api/drafts/${draftId}/campaign`, { data: { campaignId: null } })).status(),
  ).toBe(403);
  await gmContext.close();

  // The player, on their own character: the step to change it.
  await page.goto(`/c/${draftId}/campaign`);
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveValue(campaign.id);
});

test("en: the campaign step in English only", async ({ page, browser, foreign }) => {
  void foreign;
  const m = en;
  await signup(page, "Robin", "en");
  const id = await invite(browser, "Thursday group", page);
  await page.goto("/new");
  await page.waitForURL(/\/c\/[0-9a-f-]+\/campaign$/);
  await expect(page.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await expect(page.getByLabel(m["new.campaignLabel"], { exact: true })).toHaveValue(id);
  await expectOneLanguage(page, "en");
  await shot(page, "94-campaign-choose-en");
  await page.getByRole("button", { name: m["common.next"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
});
