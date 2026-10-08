/**
 * Campaigns (plan 4.3, done criterion 6; invitations by link, AND-237): a
 * game master makes a campaign and reads its invitation link and QR code
 * off the page. A newcomer on a phone opens the link, gets started with a
 * name, keeps the password, is in the campaign and builds a character for
 * it, which the game master then sees. Someone with an account joins with
 * one button; opening the link again changes nothing. A new link stops the
 * old one, the players stay. Everyone sees names, never addresses. A
 * stranger sees nothing of it. No mail is sent for any of it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { readdir } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  answerCharacter,
  chooseLanguage,
  expect,
  expectOneLanguage,
  OUTBOX,
  shot,
  signup,
  test,
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

/** The invitation link as the game master's page shows it, and the link the QR code holds. */
async function readInvite(page: Page) {
  const section = page.getByRole("region", { name: de["campaign.inviteTitle"] });
  const link = (await section.locator(".copy-text__value").textContent())!.trim();
  const qr = (await section.locator("svg.qr-code > title").textContent())!.trim();
  return { link, qr, path: new URL(link).pathname };
}

test("game master, newcomer, player with an account and a stranger", async ({ page, browser, foreign }) => {
  void foreign;
  const m = de;
  const [gmName, newcomer, member] = ["Kim", `Robin ${Date.now() % 10_000}`, "Alex"];
  const campaignName = "Donnerstagsrunde";
  const mailsBefore = (await readdir(OUTBOX).catch(() => [])).length;

  // ---------------------------------------------------- the game master
  await signup(page, gmName, "de");
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

  // The link, with what it does, and the same link as a QR code drawn on the page.
  await expect(page.getByText(m["campaign.inviteText"])).toBeVisible();
  // No adding by address any more.
  await expect(page.getByRole("main").locator('input[type="email"]')).toHaveCount(0);
  const invite = await readInvite(page);
  expect(invite.link).toMatch(/\/join\/[A-Za-z0-9_-]{22}$/);
  expect(invite.qr).toBe(invite.link);
  const qrBox = (await page.locator("svg.qr-code").boundingBox())!;
  expect(qrBox.width).toBeGreaterThanOrEqual(200);
  await expect(page.getByText(m["campaign.noPlayers"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "95-kampagne-einladen");
  await page.setViewportSize(DESKTOP);
  // At a desk, the code stands next to the link.
  const linkBox = (await page.locator(".invite__link").boundingBox())!;
  const deskQr = (await page.locator("svg.qr-code").boundingBox())!;
  expect(deskQr.x).toBeGreaterThan(linkBox.x + linkBox.width - 1);
  await shot(page, "95-kampagne-einladen-desktop");

  // ------------------------------------------- a newcomer, on the phone
  const p2 = await newPage(browser, "newcomer");
  await p2.goto(invite.path);
  await expect(
    p2.getByRole("heading", {
      level: 1,
      name: m["join.title"].replace("{gameMaster}", gmName).replace("{name}", campaignName),
    }),
  ).toBeVisible();
  await expect(p2.getByText(m["join.text"])).toBeVisible();
  await expectOneLanguage(p2, "de");
  await noAxeViolations(p2);
  await shot(p2, "95-einladung-neuling");
  await p2.getByLabel(m["login.nameLabel"]).fill(newcomer);
  await p2.getByRole("button", { name: m["login.start"] }).click();
  const shown = p2.getByRole("region", { name: m["password.welcome"].replace("{name}", newcomer) });
  await expect(shown.locator(".copy-text__value")).not.toBeEmpty();
  await shown.getByRole("button", { name: m["password.done"] }).click();
  // Straight on to a new character, with the campaign chosen and "no campaign" still there.
  await p2.waitForURL(`**/new?campaign=${campaignId}`);
  const pick = p2.getByLabel(m["new.campaignLabel"]);
  await expect(pick).toHaveValue(campaignId);
  await expect(pick.locator("option")).toHaveText([campaignName, m["new.noCampaign"]]);
  await shot(p2, "94-einladung-kampagne-gewaehlt");
  await p2.getByRole("button", { name: m["common.next"] }).click();
  await p2.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  const draftId = /\/c\/([0-9a-f-]+)\//.exec(p2.url())![1]!;
  await answerCharacter(p2, draftId);

  // The game master sees the newcomer and their character, as a card.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(campaignUrl);
  const playerBlock = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: newcomer }) });
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

  // Building for the player: the same flow, the top bar says for whom.
  await playerBlock.getByRole("link", { name: m["campaign.buildFor"].replace("{name}", newcomer) }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
  await expect(page.locator(".topbar")).toContainText(m["flow.forPlayer"].replace("{name}", newcomer));
  await shot(page, "95-bauen-fuer-spieler");

  // The newcomer sees the campaign and who leads it, nothing of other players.
  await p2.goto("/campaigns");
  await expect(p2.getByRole("heading", { level: 2, name: m["campaigns.playing"] })).toBeVisible();
  await expect(p2.getByText(m["campaigns.ledBy"].replace("{name}", gmName))).toBeVisible();
  await shot(p2, "97-spieler-kampagnen");
  await p2.getByRole("link", { name: m["campaigns.openLabel"].replace("{name}", campaignName) }).click();
  await expect(p2.getByText(m["campaign.playerTitle"].replace("{name}", gmName))).toBeVisible();
  // A player never gets the link.
  await expect(p2.getByRole("region", { name: m["campaign.inviteTitle"] })).toHaveCount(0);
  await noAxeViolations(p2);
  await p2.context().close();

  // ---------------------------------------- someone with an account
  const p3 = await newPage(browser, "member-x");
  await signup(p3, member);
  await p3.goto(invite.path);
  await expect(p3.getByLabel(m["login.nameLabel"])).toHaveCount(0);
  await shot(p3, "95-einladung-mit-konto");
  await p3.getByRole("button", { name: m["join.join"] }).click();
  await p3.waitForURL(`**/new?campaign=${campaignId}`);
  await expect(p3.getByLabel(m["new.campaignLabel"])).toHaveValue(campaignId);
  // Opening it again changes nothing.
  await p3.goto(invite.path);
  await p3.getByRole("button", { name: m["join.join"] }).click();
  await p3.waitForURL(`**/new?campaign=${campaignId}`);
  // "Not now" goes to the character list without joining anything.
  await p3.goto(invite.path);
  await p3.getByRole("link", { name: m["join.notNow"] }).click();
  await expect(p3.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();

  await page.goto(campaignUrl);
  await expect(page.locator(".player__name")).toHaveText([newcomer, member]);

  // ----------------------------------------------------- a new link
  await page.getByRole("button", { name: m["campaign.renew"] }).click();
  const dialog = page.getByRole("dialog", { name: m["campaign.renewTitle"] });
  await expect(dialog.getByText(m["campaign.renewText"])).toBeVisible();
  await dialog.getByRole("button", { name: m["campaign.renew"] }).click();
  await expect(page.getByText(m["campaign.renewed"])).toBeVisible();
  const renewed = await readInvite(page);
  expect(renewed.link).not.toBe(invite.link);
  expect(renewed.qr).toBe(renewed.link);
  await p3.goto(invite.path);
  await expect(p3.getByText(m["join.notFound"])).toBeVisible();
  await shot(p3, "95-einladung-alt");
  expect((await p3.request.get(`/api${invite.path.replace("/join/", "/invites/")}`)).status()).toBe(404);
  await page.reload();
  await expect(page.locator(".player__name")).toHaveText([newcomer, member]);
  await p3.context().close();

  // ---------------------------------------------------------- a stranger
  const p4 = await newPage(browser, "stranger");
  await signup(p4, "fremd");
  await expect(p4.getByText(m["characters.emptyTitle"])).toBeVisible();
  await p4.goto("/campaigns");
  await expect(p4.getByText(m["campaigns.emptyTitle"])).toBeVisible();
  await p4.goto(`/campaigns/${campaignId}`);
  await expect(p4.getByText(m["campaign.notFound"])).toBeVisible();
  await p4.goto(`/c/${draftId}/overview`);
  await expect(p4.getByText(m["flow.notFound"])).toBeVisible();
  await p4.goto(`/new?campaign=${campaignId}&player=00000000-0000-4000-8000-000000000000`);
  await expect(p4.getByText(m["campaign.notFound"])).toBeVisible();
  expect((await p4.request.get(`/api/drafts/${draftId}/pdf`)).status()).toBe(404);
  await shot(p4, "98-fremder-sieht-nichts");
  await p4.context().close();

  // Not one mail for any of it.
  expect((await readdir(OUTBOX).catch(() => [])).length).toBe(mailsBefore);
});

test("en: campaigns in English only, phone and desktop", async ({ page, foreign }) => {
  void foreign;
  const m = en;
  await signup(page, "Sam", "en");
  await page.goto("/campaigns");
  await page.getByLabel(m["campaigns.newLabel"]).fill("Thursday group");
  await page.getByRole("button", { name: m["campaigns.create"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thursday group" })).toBeVisible();
  await expect(page.getByRole("region", { name: m["campaign.inviteTitle"] })).toBeVisible();
  await expect(page.getByText(m["campaign.inviteText"])).toBeVisible();
  const path = new URL((await page.locator(".copy-text__value").textContent())!.trim()).pathname;
  await expectOneLanguage(page, "en");
  await shot(page, "95-campaign-en");

  // A newcomer in English joins: name, password, the campaign chosen.
  const guest = await page
    .context()
    .browser()!
    .newContext({
      extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + 7) % 250}` },
    });
  const p2 = await guest.newPage();
  await p2.goto("/login");
  await chooseLanguage(p2, "en");
  await p2.goto(path);
  await expect(
    p2.getByRole("heading", {
      level: 1,
      name: m["join.title"].replace("{gameMaster}", "Sam").replace("{name}", "Thursday group"),
    }),
  ).toBeVisible();
  await expectOneLanguage(p2, "en");
  await shot(p2, "95-invitation-en");
  await p2.getByLabel(m["login.nameLabel"]).fill("Jo");
  await p2.getByRole("button", { name: m["login.start"] }).click();
  await p2.getByRole("button", { name: m["password.done"] }).click();
  await p2.waitForURL(/\/new\?campaign=/);
  await expect(p2.getByRole("heading", { level: 1, name: m["new.campaignQuestion"] })).toBeVisible();
  await guest.close();

  await page.reload();
  await expect(page.getByRole("heading", { level: 3, name: "Jo" })).toBeVisible();
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
