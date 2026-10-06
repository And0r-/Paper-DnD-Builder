/**
 * Levels 1 to 20 on screen: the level screen (one number field), raising values with a limit, a refused change in
 * plain words, and the step list of a long build grouped by level.
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, type Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, makeLeveled, shot, test, uniqueEmail } from "./helpers.ts";

test("the level screen: one number field, starting at 1", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("levels"));
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Welche Stufe hat dein Charakter?" }),
  ).toBeVisible();
  const level = page.locator(".topbar__character");

  // One field named "Stufe", at 1; no cards, no range line, the one-sentence hint under it.
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  await expect(field).toHaveValue("1");
  await expect(field).toHaveAccessibleDescription(
    "Wenn deine Spielleitung nichts anderes sagt, nimm Stufe 1.",
  );
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Von 1 bis 20")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stufe tiefer" })).toHaveAttribute("aria-disabled", "true");
  await expectOneLanguage(page, "de");
  await shot(page, "72-stufenwahl");

  // The buttons step, a typed number counts, Enter takes it.
  await page.getByRole("button", { name: "Stufe höher" }).click();
  await expect(level).toContainText("Stufe 2");
  await expect(field).toHaveValue("2");
  await field.fill("20");
  await field.press("Enter");
  await expect(level).toContainText("Stufe 20");
  await expect(page.getByRole("button", { name: "Stufe höher" })).toHaveAttribute("aria-disabled", "true");
  // Over the top: the range is said only now, and leaving cuts it to the highest level.
  await field.fill("25");
  await expect(page.getByText("Von 1 bis 20")).toBeVisible();
  await field.press("Tab");
  await expect(field).toHaveValue("20");
  await expect(page.getByText("Von 1 bis 20")).toHaveCount(0);
  // Below 1 is cut to 1.
  await field.fill("0");
  await field.press("Tab");
  await expect(field).toHaveValue("1");
  await expect(level).toContainText("Stufe 1");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Keyboard: arrows in the field step the level.
  await field.focus();
  await page.keyboard.press("ArrowUp");
  await field.press("Enter");
  await expect(level).toContainText("Stufe 2");
  await shot(page, "73-stufenwahl-andere");
});

test("lowering the level asks first, and says which choices drop out", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("level-lower"));
  const id = await makeLeveled(page, 5);
  await page.goto(`/c/${id}/level`);
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  await expect(field).toHaveValue("5");
  const dialog = page.getByRole("dialog", { name: "Stufe ändern?" });
  // The screen is drawn on the server first; a number typed before the page is live is lost.
  await expect(async () => {
    await field.fill("1");
    await field.press("Enter");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(dialog).toContainText("Bei Stufe 1 fallen diese Wahlen weg:");
  // Keeping it leaves level and field as they were.
  await dialog.getByRole("button", { name: m["change.keep"] }).click();
  await expect(page.locator(".topbar__character")).toContainText("Stufe 5");
  await expect(field).toHaveValue("5");
  await field.fill("1");
  await field.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: m["change.confirm"] }).click();
  await expect(page.locator(".topbar__character")).toContainText("Stufe 1");
});

test.describe("in English, on a large screen", () => {
  // The desktop device without its browser type: a group may not switch browsers.
  const { defaultBrowserType: _, ...desktop } = devices["Desktop Chrome"];
  test.use({ ...desktop, viewport: { width: 1366, height: 900 } });

  test("the same one field", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("levels-en"), "en");
    await page.getByRole("link", { name: en["characters.emptyAction"] }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "What level is your character?" }),
    ).toBeVisible();
    const field = page.getByRole("spinbutton", { name: "Level" });
    await expect(field).toHaveValue("1");
    await expect(field).toHaveAccessibleDescription("Unless your game leader says otherwise, pick level 1.");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Higher level" })).toBeVisible();
    await expectOneLanguage(page, "en");
    await shot(page, "72-stufenwahl-desktop-en");
  });
});

test("raising values: old value, points, new value, and why a row is full", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("raise"));
  // Level 20, everything recommended up to the boon of level 16: heart is at its limit 15 by then.
  const id = await makeLeveled(page, 20, "calling.lantern-bearer", "boon-raise@boon-16");
  await page.goto(`/c/${id}/step/${encodeURIComponent("boon-raise@boon-16")}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Welche Grundwerte werden besser?" }),
  ).toBeVisible();
  await expect(page.locator(".progress__text")).toContainText("Stufe 16");

  const row = (name: string) => page.locator(".pointbuy__row", { hasText: name });
  await expect(row("Herz")).toContainText("15 + 0 = 15");
  await expect(row("Herz")).toContainText("Schon 15. Höher geht es hier nicht.");
  await expect(row("Herz").getByRole("button", { name: "Herz erhöhen" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // 2 points on one value.
  const plus = (name: string) => row(name).getByRole("button", { name: `${name} erhöhen` });
  const minus = (name: string) => row(name).getByRole("button", { name: `${name} senken` });
  await plus("Kraft").click();
  await plus("Kraft").click();
  await expect(row("Kraft")).toContainText("8 + 2 = 10");
  await expect(page.getByText(m["dist.allSpent"])).toBeVisible();
  await expect(plus("Geschick")).toHaveAttribute("aria-disabled", "true");
  // Or 1 each on two.
  await minus("Kraft").click();
  await plus("Geschick").click();
  await expect(row("Kraft")).toContainText("8 + 1 = 9");
  await expect(page.getByText(m["dist.allSpent"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "74-werte-anheben");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // A point is free again before the server is asked.
  await minus("Geschick").click();
  await expect(row("Geschick")).toContainText("8 + 0 = 8");
  await expect(page.getByText(m["save.saved"])).toBeVisible();
  // The server refuses (say another tab raised the value meanwhile): plain words, no code.
  await page.route("**/api/drafts/*/answers/**", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "changeRejected", reason: { code: "answerDoesNotFit", problem: "outOfRange" } },
      }),
    }),
  );
  await plus("Klugheit").click();
  await expect(page.locator(".callout--danger")).toHaveText(m["flow.rejectedOutOfRange"]);
  await page.unroute("**/api/drafts/*/answers/**");
  await shot(page, "75-werte-anheben-fehler");
});

/**
 * Opens the menu on the phone. A level-20 step screen is drawn on the server
 * first; a tap before the page is live is lost, so the tap is repeated until
 * the button reports the menu as open.
 */
async function openMenu(page: Page) {
  const button = page.getByRole("button", { name: m["menu.open"] });
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

test("a long build: the step list groups the steps a higher level brings", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("steplist"));
  const id = await makeLeveled(page, 20, "calling.lantern-bearer", "boon-raise@boon-8");
  await page.goto(`/c/${id}/step/${encodeURIComponent("boon-raise@boon-8")}`);
  await openMenu(page);
  const list = page.locator(".steplist").first();
  // The boons are one step of the count, with their levels inside.
  await expect(list.getByRole("link", { name: /^Gaben/ })).toContainText("Stufe 4 bis 19");
  await expect(list.getByText("Ab Stufe 8", { exact: true })).toBeVisible();
  await expect(list.locator("[aria-current='step']")).toContainText("Stärker werden");
  await shot(page, "76-schrittliste-stufen");
  // Elsewhere the group stays closed: one line, and the parts of other steps are not listed.
  await page.goto(`/c/${id}/step/folk`);
  await openMenu(page);
  await expect(page.locator(".steplist").first().getByText("Ab Stufe 8", { exact: true })).toHaveCount(0);
  // Demo 0.10.0: the mastery step (level 18) makes it 15 steps.
  await expect(page.locator(".progress__text")).toContainText("von 15");
});
