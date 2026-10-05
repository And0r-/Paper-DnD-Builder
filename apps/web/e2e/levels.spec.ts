/**
 * Levels 1 to 20 on screen: the level screen (common levels as cards, any
 * other level by number), raising values with a limit, a refused change in
 * plain words, and the step list of a long build grouped by level.
 */
import AxeBuilder from "@axe-core/playwright";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, login, makeLeveled, shot, test, uniqueEmail } from "./helpers.ts";

test("the level screen: common levels as cards, any other by number", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("levels"));
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Welche Stufe hat dein Charakter?" }),
  ).toBeVisible();
  const level = page.locator(".topbar__character");

  // Level 1 is chosen and recommended, with why.
  const one = page.getByRole("radio", { name: "Stufe 1" });
  await expect(one).toBeChecked();
  await expect(page.locator(".level-card").first()).toContainText(m["common.recommended"]);
  await expect(page.locator(".level-card").first()).toContainText("Für den Anfang.");
  // No wall of 20 buttons: three common levels and "another level".
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expectOneLanguage(page, "de");
  await shot(page, "72-stufenwahl");

  await page.getByRole("radio", { name: "Stufe 5" }).check();
  await expect(level).toContainText("Stufe 5");

  // Another level: the number field starts at the current level, steps and takes a typed number.
  await page.getByRole("radio", { name: "Andere Stufe" }).check();
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  await expect(field).toHaveValue("5");
  await page.getByRole("button", { name: "Stufe höher" }).click();
  await expect(level).toContainText("Stufe 6");
  await field.fill("20");
  await field.press("Enter");
  await expect(level).toContainText("Stufe 20");
  await expect(page.getByRole("button", { name: "Stufe höher" })).toHaveAttribute("aria-disabled", "true");
  // Over the top is cut to the highest level.
  await field.fill("25");
  await field.press("Tab");
  await expect(field).toHaveValue("20");
  await page.getByRole("radio", { name: "Andere Stufe" }).scrollIntoViewIfNeeded();
  await shot(page, "73-stufenwahl-andere");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Keyboard: arrows move between the cards.
  await page.getByRole("radio", { name: "Andere Stufe" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("radio", { name: "Stufe 5" })).toBeChecked();
  await expect(level).toContainText("Stufe 5");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(one).toBeChecked();
  await expect(level).toContainText("Stufe 1");
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

test("a long build: the step list groups the steps a higher level brings", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("steplist"));
  const id = await makeLeveled(page, 20, "calling.lantern-bearer", "boon-raise@boon-8");
  await page.goto(`/c/${id}/step/${encodeURIComponent("boon-raise@boon-8")}`);
  await page.getByRole("button", { name: m["menu.open"] }).click();
  const list = page.locator(".steplist").first();
  // The boons are one step of the count, with their levels inside.
  await expect(list.getByRole("link", { name: /^Gaben/ })).toContainText("Stufe 4 bis 19");
  await expect(list.getByText("Ab Stufe 8", { exact: true })).toBeVisible();
  await expect(list.locator("[aria-current='step']")).toContainText("Stärker werden");
  await shot(page, "76-schrittliste-stufen");
  // Elsewhere the group stays closed: one line, and the parts of other steps are not listed.
  await page.goto(`/c/${id}/step/folk`);
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await expect(page.locator(".steplist").first().getByText("Ab Stufe 8", { exact: true })).toHaveCount(0);
  // Demo 0.10.0: the mastery step (level 18) makes it 15 steps.
  await expect(page.locator(".progress__text")).toContainText("von 15");
});
