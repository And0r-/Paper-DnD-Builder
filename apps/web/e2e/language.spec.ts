/**
 * Done criterion 2: switching the language swaps every text, and no
 * screen ever shows texts of both languages at once.
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import pde from "../../../packages/demo-package/texts/de/core.json" with { type: "json" };
import pen from "../../../packages/demo-package/texts/en/core.json" with { type: "json" };
import { expect, expectOneLanguage, login, makeCharacter, shot, test, uniqueEmail } from "./helpers.ts";

type Lang = "de" | "en";

/** Every kind of screen, each with its "learn more" panels open where there are some. */
async function visitAll(page: Page, id: string, lang: Lang) {
  const m = lang === "de" ? de : en;
  const p = (lang === "de" ? pde : pen).entries as Record<string, string>;
  const screens: [string, string | RegExp][] = [
    ["/characters", m["characters.title"]],
    [`/c/${id}/level`, m["level.question"].replace("{levelName}", p["level.name"]!)],
    [`/c/${id}/step/folk`, p["choice.folk.question"]!],
    [`/c/${id}/step/talents`, p["step.talents.question"]!],
    [`/c/${id}/step/knacks`, p["step.knacks.question"]!],
    [`/c/${id}/step/calling-gifts`, p["choice.calling-gifts.question"]!],
    [`/c/${id}/step/scores`, p["choice.scores.question"]!],
    [`/c/${id}/step/character`, p["step.character.question"]!],
    [`/c/${id}/step/looks`, p["step.looks.question"]!],
    [`/c/${id}/overview`, m["overview.question"]],
    [`/c/${id}/done`, m["done.title"].replace("{name}", "Mira")],
    ["/new", m["level.question"].replace("{levelName}", p["level.name"]!)],
    ["/settings", m["settings.title"]],
    ["/privacy", m["privacy.title"]],
    ["/mcp/setup", m["mcp.title"]],
  ];
  for (const [url, heading] of screens) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const more = page.getByRole("main").getByRole("button", { name: m["common.moreInfo"] });
    while ((await more.count()) > 0) await more.first().click();
    await expectOneLanguage(page, lang);
    if (url.endsWith("/step/folk")) await shot(page, `23-herkunft-${lang}`);
  }
  // A glossary explanation and the menu, too.
  await page.goto(`/c/${id}/overview`);
  await page.locator(".glossary-term").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectOneLanguage(page, lang);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await expectOneLanguage(page, lang);
  await shot(page, `20-menue-${lang}`);
}

test("every screen shows exactly one language, and switching swaps all texts", async ({ page, foreign }) => {
  void foreign;
  // Before login: the browser says German; the switch at the top changes everything.
  await page.goto("/login");
  await expectOneLanguage(page, "de");
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { name: en["login.title"] })).toBeVisible();
  await expectOneLanguage(page, "en");
  await shot(page, "21-login-en");
  await page.getByText("Deutsch", { exact: true }).click();
  await expectOneLanguage(page, "de");

  await login(page, uniqueEmail("lang"));
  const id = await makeCharacter(page);
  await visitAll(page, id, "de");

  await page.goto("/settings");
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();
  await expectOneLanguage(page, "en");
  await shot(page, "22-einstellungen-en");
  await visitAll(page, id, "en");

  // The choice is stored with the account: a fresh visit stays English.
  await page.reload();
  await expectOneLanguage(page, "en");
});
