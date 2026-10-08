/**
 * Campaigns (plan 4.3, done criterion 6): a player gets started with a mail
 * address; a game master makes a campaign, adds the player by that
 * address and builds a character for them. The player finds it in their
 * own list. Everyone sees names, never addresses. A third account sees
 * nothing of it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  answerCharacter,
  expect,
  expectOneLanguage,
  mailTo,
  shot,
  signup,
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
  const [gmName, playerName] = ["Kim", `Robin ${Date.now() % 10_000}`];
  const campaignName = "Donnerstagsrunde";

  // The player gets started first, with the address the game master will type.
  const p2 = await newPage(browser, "player");
  await signup(p2, playerName, "de", player);

  // ---------------------------------------------------- the game master
  await signup(page, gmName, "de", gm);
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

  // The hint says whose address to type, who gets a mail and who adds them.
  const field = page.getByLabel(m["campaign.addLabel"]);
  await expect(
    page.getByText(m["campaign.addHelp"].replace("{gameMaster}", gmName).replace("{name}", campaignName)),
  ).toBeVisible();
  await field.fill("kein-at-zeichen");
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["login.emailInvalid"])).toBeVisible();
  await field.fill(gm);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["campaign.cannotAddYourself"])).toBeVisible();
  await field.fill(player);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByText(m["campaign.added"].replace("{name}", playerName))).toBeVisible();
  const playerBlock = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: playerName }) });
  // The player's address is not on the screen; the game master typed it, the server does not repeat it.
  await expect(page.getByRole("main")).not.toContainText(player);
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
  await playerBlock.getByRole("link", { name: m["campaign.buildFor"].replace("{name}", playerName) }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  await expect(page.locator(".topbar")).toContainText(m["flow.forPlayer"].replace("{name}", playerName));
  await expectOneLanguage(page, "de");
  await shot(page, "95-bauen-fuer-spieler");
  await answerCharacter(page, draftId);
  await page.goto(`/c/${draftId}/done`);
  await expect(page.getByText(m["done.forPlayer"].replace("{name}", playerName))).toBeVisible();
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
  // The mail names the game master by name and the campaign; it holds no password.
  const mail = await mailTo(player);
  expect(mail).toContain(gmName);
  expect(mail).not.toContain(gm);
  expect(mail).toContain(campaignName);
  expect(mail).not.toMatch(/Passwort:/);
  await p2.goto("/characters");
  await expect(p2.getByRole("heading", { level: 2, name: "Mira" })).toBeVisible();
  await expect(p2.getByText("Laternenträgerin · Stufe 3")).toBeVisible();
  await shot(p2, "97-spieler-sieht-charakter");

  // The player sees the campaign and who leads it, nothing of other players.
  await p2.goto("/campaigns");
  await expect(p2.getByRole("heading", { level: 2, name: m["campaigns.playing"] })).toBeVisible();
  await expect(p2.getByText(m["campaigns.ledBy"].replace("{name}", gmName))).toBeVisible();
  await expectOneLanguage(p2, "de");
  await shot(p2, "97-spieler-kampagnen");
  await p2.getByRole("link", { name: m["campaigns.openLabel"].replace("{name}", campaignName) }).click();
  await expect(p2.getByText(m["campaign.playerTitle"].replace("{name}", gmName))).toBeVisible();
  await expect(p2.getByLabel(m["campaign.addLabel"])).toHaveCount(0);
  await noAxeViolations(p2);
  await p2.context().close();

  // ---------------------------------------------------------- a stranger
  const p3 = await newPage(browser, "stranger");
  await signup(p3, "fremd");
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
  await signup(page, "Sam", "en", player.replace("player-en", "gm-en"));
  // An address nobody gave yet: an account without a password, named after the address, no mail.
  await page.goto("/campaigns");
  await page.getByLabel(m["campaigns.newLabel"]).fill("Thursday group");
  await page.getByRole("button", { name: m["campaigns.create"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thursday group" })).toBeVisible();
  await page.getByLabel(m["campaign.addLabel"]).fill(player);
  await page.getByRole("button", { name: m["campaign.add"] }).click();
  await expect(page.getByRole("heading", { level: 3, name: player.split("@")[0]! })).toBeVisible();
  await expectOneLanguage(page, "en");
  await shot(page, "95-campaign-en");
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
  await signup(page, "datenschutz");
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
