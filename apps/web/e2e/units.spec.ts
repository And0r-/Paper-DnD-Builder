/**
 * Done criterion 3: changing units applies at once on every screen, and
 * units stay what they are when the language changes (plan 5.6).
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, login, makeCharacter, shot, test, uniqueEmail } from "./helpers.ts";

async function folkPace(page: Page, id: string, lang: "de" | "en") {
  await page.goto(`/c/${id}/step/folk`);
  await page
    .getByRole("button", { name: (lang === "de" ? de : en)["common.moreInfo"] })
    .first()
    .click();
  return page.getByRole("main").locator(".details").first().innerText();
}

async function overviewPace(page: Page, id: string) {
  await page.goto(`/c/${id}/overview`);
  return page
    .locator(".value")
    .filter({ hasText: /Tempo|Pace/ })
    .locator(".value__number")
    .innerText();
}

async function knackReach(page: Page, id: string, lang: "de" | "en") {
  await page.goto(`/c/${id}/step/knacks-lantern`);
  const card = page.locator("[data-option='knack.glow-thread']");
  await card.getByRole("button", { name: (lang === "de" ? de : en)["common.moreInfo"] }).click();
  return card.locator(".stats").innerText();
}

test("units switch at once everywhere and do not follow the language", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("units"));
  const id = await makeCharacter(page);

  // German starts with meters.
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Meter", exact: true })).toBeChecked();
  await expect(page.getByText("Beispiel: 9 Meter")).toBeVisible();
  expect(await folkPace(page, id, "de")).toContain("Dein Tempo ist 7,5 Meter.");
  expect(await overviewPace(page, id)).toBe("7,5 m");
  expect(await knackReach(page, id, "de")).toContain("18 Meter");

  // Feet: every screen follows right away.
  await page.goto("/settings");
  await page.getByText("Fuss", { exact: true }).click();
  await expect(page.getByText("Beispiel: 30 Fuss")).toBeVisible();
  await shot(page, "30-einheiten-fuss");
  expect(await folkPace(page, id, "de")).toContain("Dein Tempo ist 25 Fuss.");
  expect(await overviewPace(page, id)).toBe("25 Fuss");
  expect(await knackReach(page, id, "de")).toContain("60 Fuss");

  // A language change keeps the units.
  await page.goto("/settings");
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "feet", exact: true })).toBeChecked();
  expect(await folkPace(page, id, "en")).toContain("Your pace is 25 feet.");
  expect(await overviewPace(page, id)).toBe("25 ft");

  // And meters in English work just as well.
  await page.goto("/settings");
  await page.getByText("meters", { exact: true }).click();
  expect(await folkPace(page, id, "en")).toContain("Your pace is 7.5 meters.");
  expect(await overviewPace(page, id)).toBe("7.5 m");
});
