/**
 * The step "Rules" (AND-336), against a server with two games (project
 * "two-games", e2e/two-games.ts). "New character" asks the rules and no
 * longer says that they are for good; the step stands in the list after
 * the campaign, answered. Switching asks first: "Cancel" changes nothing,
 * "Switch" drops every answer, keeps level and campaign, shows the new
 * package's steps, all open, and goes on at the first of them. Switching
 * back works the same way; a finished character is told it will not be
 * finished any more.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  expectOneLanguage,
  makeCharacter,
  makeLeveled,
  SCREEN,
  shot,
  signup,
  test,
} from "./helpers.ts";
import { OTHER } from "./two-games.ts";

const m = de;
const DESKTOP = { width: 1366, height: 900 };
const DEMO_NAME = "Nebelland";
const DEMO_SHORT = "Eine kleine erfundene Welt aus Mooren, Flüssen und Laternenlicht. Gut zum Ausprobieren.";
const OTHER_NAME = OTHER.de["package.name"];

async function noAxeViolations(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

interface Draft {
  packageId: string;
  level: number;
  version: number;
  status: string;
  campaignId: string | null;
  answers: Record<string, unknown>;
}

async function draftOf(page: Page, id: string): Promise<Draft> {
  return ((await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: Draft }).draft;
}

/** A campaign led by someone else, joined by the player through its invitation link. */
async function invite(browser: Browser, name: string, player: Page): Promise<string> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + name.length) % 250}` },
  });
  const page = await context.newPage();
  await signup(page, "leitung");
  const made = await page.request.post("/api/campaigns", { data: { name } });
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  await context.close();
  const joined = await player.request.post(`/api/invites/${campaign.inviteUrl.split("/join/")[1]!}/join`);
  expect(joined.status()).toBe(200);
  return campaign.id;
}

/** A package's card by its name and short text, as read aloud ("Mistland" alone is a part of "Mistland, first edition"). */
const card = (page: Page, name: string, short: string) =>
  page.getByRole("radio", { name: `${name} ${short}`, exact: true });
const demoCard = (page: Page) => card(page, DEMO_NAME, DEMO_SHORT);
const otherCard = (page: Page) => card(page, OTHER_NAME, OTHER.de["package.short"]);
const stepList = (page: Page) => page.getByRole("navigation", { name: m["flow.steps"] });
const stepLink = (page: Page, title: string) =>
  stepList(page).getByRole("link", { name: new RegExp(`^${title}`) });
const switchText = (old: string) =>
  m["rules.switchText"].replace("{old}", old).replace("{levelName}", "Stufe");

test("new character: asks the rules, not for good; the step stands answered in the list", async ({
  page,
  foreign,
}) => {
  void foreign;
  await signup(page, "Regeln");
  await page.goto("/new");
  await expect(page.getByRole("heading", { level: 1, name: m["rules.question"] })).toBeVisible();
  await expect(page.getByText(m["rules.intro"])).toBeVisible();
  await expect(demoCard(page)).toBeVisible();
  await expect(otherCard(page)).toBeVisible();
  await expect(page.getByText(OTHER.de["package.short"])).toBeVisible();
  await expect(page.getByText(/nicht mehr ändern/)).toHaveCount(0);
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "95-neuer-charakter-regeln");

  await demoCard(page).check();
  await page.getByRole("button", { name: m["new.start"] }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const id = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  await page.setViewportSize(DESKTOP);
  // No campaign: "Rules" is the first step, answered.
  const rules = stepLink(page, m["rules.title"]);
  await expect(stepList(page).getByRole("link").first()).toHaveAttribute("href", `/c/${id}/rules`);
  await expect(rules).toHaveClass(/steplist__link--done/);
  await rules.click();
  await page.waitForURL(new RegExp(`/c/${id}/rules$`));
  await expect(page.getByRole("heading", { level: 1, name: m["rules.question"] })).toBeVisible();
  await expect(page.getByText(m["rules.intro"])).toBeVisible();
  await expect(demoCard(page)).toBeChecked();
  await expect(rules).toHaveAttribute("aria-current", "step");
  await noAxeViolations(page);
  await shot(page, "95-regeln-schritt-desktop");
});

test("Cancel changes nothing; Switch drops every answer, keeps level and campaign; switching back works", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await signup(page, "Wechsel");
  const campaign = await invite(browser, "Montagsrunde", page);
  // Level 5 with the step of the path (the subclass of the demo game) answered, in a campaign.
  const id = await makeLeveled(page, 5);
  const moved = await page.request.put(`/api/drafts/${id}/campaign`, { data: { campaignId: campaign } });
  expect(moved.status()).toBe(200);
  const before = await draftOf(page, id);
  expect(before.answers["path"]).toBeDefined();

  await page.setViewportSize(DESKTOP);
  await page.goto(`/c/${id}/rules`);
  // After the campaign.
  await expect(stepList(page).getByRole("link").nth(1)).toHaveAttribute("href", `/c/${id}/rules`);
  await expect(stepLink(page, "Aussehen")).toBeVisible();

  // Cancel: nothing changes, the card goes back.
  await otherCard(page).check();
  const dialog = page.getByRole("dialog", { name: m["rules.switchTitle"] });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(switchText(DEMO_NAME));
  await expect(dialog).not.toContainText(m["rules.switchFinished"]);
  await noAxeViolations(page);
  await shot(page, "95-regeln-wechseln-dialog");
  await dialog.getByRole("button", { name: m["common.cancel"] }).click();
  await expect(dialog).toBeHidden();
  await expect(demoCard(page)).toBeChecked();
  expect(await draftOf(page, id)).toEqual(before);

  // Switch: the new package's steps, all open; level and campaign stay; on at the first open step.
  await otherCard(page).check();
  await dialog.getByRole("button", { name: m["rules.switch"] }).click();
  await page.waitForURL(new RegExp(`/c/${id}/step/`));
  const after = await draftOf(page, id);
  expect(after).toMatchObject({ packageId: "other", level: 5, campaignId: campaign });
  expect(Object.keys(after.answers).filter((c) => c !== "name")).toEqual([]);
  await expect(stepLink(page, "Gesicht")).toBeVisible();
  await expect(stepLink(page, "Aussehen")).toHaveCount(0);
  await expect(stepLink(page, m["rules.title"])).toHaveClass(/steplist__link--done/);
  await expect(stepLink(page, m["new.campaignLabel"])).toHaveClass(/steplist__link--done/);
  // Every step of the package that asks something is open again (one that only tells is never open).
  for (const title of ["Dein Charakter", "Beruf", "Herkunft", "Kindheit", "Grundwerte", "Gesicht"])
    await expect(stepLink(page, title)).not.toHaveClass(/steplist__link--done/);
  await expect(stepList(page).locator("a[href*='/step/'].steplist__link--done")).toHaveCount(1);
  await shot(page, "95-regeln-gewechselt");

  // And back.
  await stepLink(page, m["rules.title"]).click();
  await page.waitForURL(new RegExp(`/c/${id}/rules$`));
  await expect(otherCard(page)).toBeChecked();
  await demoCard(page).check();
  await expect(dialog).toContainText(switchText(OTHER_NAME));
  await dialog.getByRole("button", { name: m["rules.switch"] }).click();
  await page.waitForURL(new RegExp(`/c/${id}/step/`));
  expect(await draftOf(page, id)).toMatchObject({ packageId: "demo", level: 5, campaignId: campaign });
  await expect(stepLink(page, "Aussehen")).toBeVisible();
  await expect(stepLink(page, "Gesicht")).toHaveCount(0);
});

test("a finished character: the dialog says it will not be finished any more", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Fertig");
  const id = await makeCharacter(page);
  expect((await draftOf(page, id)).status).toBe("finished");
  await page.goto(`/c/${id}/rules`);
  await otherCard(page).check();
  const dialog = page.getByRole("dialog", { name: m["rules.switchTitle"] });
  await expect(dialog).toContainText(m["rules.switchFinished"]);
  await shot(page, "95-regeln-wechseln-fertig");
  await dialog.getByRole("button", { name: m["rules.switch"] }).click();
  await page.waitForURL(new RegExp(`/c/${id}/step/`));
  expect(await draftOf(page, id)).toMatchObject({ packageId: "other", status: "draft", level: 3 });
});

test("every screen language has the texts of the step", () => {
  const keys = Object.keys(de).filter((k) => k.startsWith("rules."));
  expect(keys.length).toBeGreaterThan(5);
  for (const messages of Object.values(SCREEN)) {
    for (const k of keys) expect((messages as Record<string, string>)[k], k).toBeTruthy();
    expect(Object.keys(messages)).not.toContain("new.note");
  }
});
