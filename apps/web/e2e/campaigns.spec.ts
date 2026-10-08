/**
 * Campaigns (plan 4.3, done criterion 6): a game master makes a campaign,
 * adds a player by mail address, builds a character for them. The player
 * takes the password from the mail folder, logs in and finds the
 * character in their own list. A third account sees nothing of it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  answerCharacter,
  expect,
  expectOneLanguage,
  login,
  OUTBOX,
  passwordFor,
  shot,
  test,
  uniqueEmail,
} from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };

async function newPage(browser: Browser, tag: string): Promise<Page> {
  const context = await browser.newContext({
    locale: "de-DE",
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + tag.length) % 250}` },
  });
  return context.newPage();
}

async function mailTo(email: string): Promise<string> {
  const files = (await readdir(OUTBOX)).filter((f) => f.includes(email)).sort();
  return readFile(join(OUTBOX, files.at(-1)!), "utf8");
}

async function noAxeViolations(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

test("game master, player and a stranger: who sees which character", async ({ page, browser, foreign }) => {
  void foreign;
  const m = de;
  const gm = uniqueEmail("leitung");
  const player = uniqueEmail("spieler");
  const campaignName = "Donnerstagsrunde";

  // ---------------------------------------------------- the game master
  await login(page, gm);
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await page
    .getByRole("dialog", { name: m["menu.title"] })
    .getByRole("link", { name: m["menu.campaigns"] })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: m["campaigns.title"] })).toBeVisible();
  await expect(page.getByText(m["campaigns.emptyTitle"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "95-kampagnen-leer");

  // A name is needed; the field says so inline.
  await page.getByRole("button", { name: m["campaigns.create"] }).click();
  await expect(page.getByText(m["campaigns.nameMissing"])).toBeVisible();
  await page.getByLabel(m["campaigns.newLabel"]).fill(campaignName);
  await page.getByRole("button", { name: m["campaigns.create"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignUrl = page.url();
  const campaignId = /\/campaigns\/([0-9a-f-]+)$/.exec(campaignUrl)![1]!;

  // The hint says who gets a mail and who invites them.
  const field = page.getByLabel(m["campaign.addLabel"]);
  await expect(
    page.getByText(m["campaign.addHelp"].replace("{email}", gm).replace("{name}", campaignName)),
  ).toBeVisible();
  await field.fill("kein-at-zeichen");
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["login.emailInvalid"])).toBeVisible();
  await field.fill(gm);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["campaign.cannotAddYourself"])).toBeVisible();
  await field.fill(player);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["campaign.added"].replace("{email}", player))).toBeVisible();
  const playerBlock = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: player }) });
  await expect(playerBlock.getByText(m["campaign.noCharacters"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "95-kampagne-spieler-eingeladen");

  // The same player twice is refused.
  await field.fill(player);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["campaign.alreadyPlayer"].replace("{email}", player))).toBeVisible();
  await field.fill("");

  // Build for the player: the same flow, the top bar says for whom.
  await playerBlock.getByRole("link", { name: m["campaign.buildFor"].replace("{email}", player) }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  await expect(page.locator(".topbar")).toContainText(m["flow.forPlayer"].replace("{email}", player));
  await expectOneLanguage(page, "de");
  await shot(page, "95-bauen-fuer-spieler");
  await answerCharacter(page, draftId);
  await page.goto(`/c/${draftId}/done`);
  await expect(page.getByText(m["done.forPlayer"].replace("{email}", player))).toBeVisible();
  await expect(page.getByRole("link", { name: m["done.another"] })).toHaveCount(0);

  // The campaign shows the character as a card under its player.
  await page.goto(campaignUrl);
  await expect(playerBlock.getByRole("heading", { level: 4, name: "Mira" })).toBeVisible();
  await expect(playerBlock.getByText("Laternenträgerin · Stufe 3")).toBeVisible();
  await expect(playerBlock.getByText(m["characters.finished"])).toBeVisible();
  await expect(playerBlock.getByRole("link", { name: `${m["characters.print"]}: Mira` })).toBeVisible();
  // A game master may change a player's character, not delete it: the menu has no "Delete".
  await playerBlock.getByRole("button", { name: m["characters.more"].replace("{name}", "Mira") }).click();
  await expect(playerBlock.getByRole("menuitem")).toHaveText([m["characters.edit"], m["raise.button"]]);
  await page.keyboard.press("Escape");
  await shot(page, "96-kampagne-mit-charakter");
  await page.setViewportSize(DESKTOP);
  await shot(page, "96-kampagne-mit-charakter-desktop");

  // ----------------------------------------------------------- the player
  // The invitation made the account; the mail names the game master and holds the password.
  const mail = await mailTo(player);
  expect(mail).toContain(gm);
  expect(mail).toContain(campaignName);
  const password = await passwordFor(player);
  const p2 = await newPage(browser, "player");
  await p2.goto("/login");
  await p2.getByRole("button", { name: m["login.havePassword"] }).click();
  await p2.getByLabel(m["login.emailLabel"]).fill(player);
  await p2.getByLabel(m["login.passwordLabel"]).fill(password);
  await p2.getByRole("button", { name: m["login.submit"], exact: true }).click();
  await expect(p2.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
  await expect(p2.getByRole("heading", { level: 2, name: "Mira" })).toBeVisible();
  await expect(p2.getByText("Laternenträgerin · Stufe 3")).toBeVisible();
  await shot(p2, "97-spieler-sieht-charakter");

  // The player sees the campaign and who leads it, nothing of other players.
  await p2.goto("/campaigns");
  await expect(p2.getByRole("heading", { level: 2, name: m["campaigns.playing"] })).toBeVisible();
  await expect(p2.getByText(m["campaigns.ledBy"].replace("{email}", gm))).toBeVisible();
  await expectOneLanguage(p2, "de");
  await shot(p2, "97-spieler-kampagnen");
  await p2.getByRole("link", { name: m["campaigns.openLabel"].replace("{name}", campaignName) }).click();
  await expect(p2.getByText(m["campaign.playerTitle"].replace("{email}", gm))).toBeVisible();
  await expect(p2.getByLabel(m["campaign.addLabel"])).toHaveCount(0);
  await noAxeViolations(p2);
  await p2.context().close();

  // ---------------------------------------------------------- a stranger
  const p3 = await newPage(browser, "stranger");
  await login(p3, uniqueEmail("fremd"));
  await expect(p3.getByText(m["characters.emptyTitle"])).toBeVisible();
  await p3.goto("/campaigns");
  await expect(p3.getByText(m["campaigns.emptyTitle"])).toBeVisible();
  await p3.goto(`/campaigns/${campaignId}`);
  await expect(p3.getByText(m["campaign.notFound"])).toBeVisible();
  await p3.goto(`/c/${draftId}/overview`);
  await expect(p3.getByText(m["flow.notFound"])).toBeVisible();
  await p3.goto(`/new?campaign=${campaignId}&player=00000000-0000-4000-8000-000000000000`);
  await expect(p3.getByText(m["campaign.notFound"])).toBeVisible();
  expect((await p3.request.get(`/api/drafts/${draftId}/pdf`)).status()).toBe(404);
  await shot(p3, "98-fremder-sieht-nichts");
  await p3.context().close();
});

test("en: campaigns in English only, phone and desktop", async ({ page, foreign }) => {
  void foreign;
  const m = en;
  const player = uniqueEmail("player-en");
  await login(page, uniqueEmail("gm-en"), "en");
  await page.goto("/campaigns");
  await page.getByLabel(m["campaigns.newLabel"]).fill("Thursday group");
  await page.getByRole("button", { name: m["campaigns.create"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thursday group" })).toBeVisible();
  await page.getByLabel(m["campaign.addLabel"]).fill(player);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByRole("heading", { level: 3, name: player })).toBeVisible();
  await expectOneLanguage(page, "en");
  await shot(page, "95-campaign-en");
  // The new account speaks the game master's language.
  expect(await mailTo(player)).toContain("Your password");
  await page.goto("/campaigns");
  await expect(page.getByText(m["campaigns.players.one"])).toBeVisible();
  await expectOneLanguage(page, "en");
  await page.setViewportSize(DESKTOP);
  await shot(page, "95-campaigns-en-desktop");
  await page.goto("/privacy");
  await expect(page.getByText(m["privacy.membership"])).toBeVisible();
  await expectOneLanguage(page, "en");
});

test("privacy and account deletion name campaigns in plain words", async ({ page, foreign }) => {
  void foreign;
  const m = de;
  await login(page, uniqueEmail("datenschutz"));
  await page.goto("/privacy");
  for (const key of [
    "privacy.campaigns",
    "privacy.membership",
    "privacy.invitations",
    "privacy.keys",
  ] as const) {
    await expect(page.getByText(m[key])).toBeVisible();
  }
  await expectOneLanguage(page, "de");
  await shot(page, "99-datenschutz");
  await page.goto("/settings");
  const section = page.getByRole("region", { name: m["settings.delete"] });
  await expect(section.getByText(m["settings.deletePlayer"])).toBeVisible();
  await expect(section.getByText(m["settings.deleteGameMaster"])).toBeVisible();
});
