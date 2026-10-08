/**
 * Done criterion 3: changing units applies at once on every screen. Units
 * the reader never chose follow the language; chosen ones stay what they
 * are when the language changes (plan 5.6, AND-120).
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { chooseLanguage, expect, makeCharacter, shot, signup, test } from "./helpers.ts";

async function storedUnits(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/account");
    return ((await r.json()) as { account: { units: Record<string, string> } }).account.units;
  });
}

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
  await page.goto(`/c/${id}/step/knacks`);
  const card = page.locator("[data-option='knack.glow-thread']");
  await card.getByRole("button", { name: (lang === "de" ? de : en)["common.moreInfo"] }).click();
  return card.locator(".stats").innerText();
}

test("units the reader never chose follow the language", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "units-follow");
  const id = await makeCharacter(page);

  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Wie die Sprache (Meter)" })).toBeChecked();
  await shot(page, "30-einheiten-wie-sprache");

  // A language change sends only the language: nothing gets pinned.
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/account/settings") && r.method() === "PATCH",
  );
  await chooseLanguage(page, "en");
  expect((await sent).postDataJSON()).toEqual({ language: "en" });
  await expect(page.getByRole("radio", { name: "Same as the language (feet)" })).toBeChecked();
  expect(await storedUnits(page)).toEqual({});
  expect(await folkPace(page, id, "en")).toContain("Your pace is 25 feet.");
  expect(await overviewPace(page, id)).toBe("25 ft");
});

test("units switch at once everywhere and chosen units stay with a new language", async ({
  page,
  foreign,
}) => {
  void foreign;
  await signup(page, "units");
  const id = await makeCharacter(page);

  // German starts with meters.
  await page.goto("/settings");
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

  // Chosen meters stay meters in English.
  await page.goto("/settings");
  await page.getByText("Meter", { exact: true }).click();
  await expect(page.getByText("Beispiel: 9 Meter")).toBeVisible();
  await chooseLanguage(page, "en");
  await expect(page.getByRole("radio", { name: "meters", exact: true })).toBeChecked();
  expect(await storedUnits(page)).toMatchObject({ length: "m" });
  expect(await folkPace(page, id, "en")).toContain("Your pace is 7.5 meters.");
  expect(await overviewPace(page, id)).toBe("7.5 m");

  // Back to "same as the language": English shows feet again.
  await page.goto("/settings");
  await page.getByText("Same as the language (feet)", { exact: true }).first().click();
  expect(await folkPace(page, id, "en")).toContain("Your pace is 25 feet.");
});
