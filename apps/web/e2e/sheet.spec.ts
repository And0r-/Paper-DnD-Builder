/**
 * The online sheet on a phone (AND-181); the same at a desk in
 * `sheet-desk.spec.ts`. Cases in `sheet-tests.ts`. Plus a character that is
 * not finished, and the sheet in English with its language from the top bar.
 */
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { chooseLanguage, expect, expectOneLanguage, login, makeCharacter, test, uniqueEmail } from "./helpers.ts";
import { sheetTests } from "./sheet-tests.ts";

const m = de;

sheetTests("phone");

test("a character that is not finished has no original yet", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("sheet-open"));
  const id = await makeCharacter(page, false);
  await page.goto(`/c/${id}/bogen`);
  await expect(page.getByText(m["sheet.notFinishedTitle"])).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: m["sheet.toBuilder"] }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/overview$`));
});

test("the sheet in English, and its language from the top bar", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("sheet-en"), "en");
  const id = await makeCharacter(page);
  await page.goto(`/c/${id}/bogen`);
  await expect(page.getByRole("heading", { level: 1, name: "Mira" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Might: \d+\. Change$/ })).toBeVisible();
  await expectOneLanguage(page, "en");
  // One language switch on the sheet, the top bar's as on every screen (AND-227); none in the menu.
  await page.getByRole("button", { name: en["menu.open"] }).click();
  const menu = page.getByRole("dialog", { name: en["menu.title"] });
  await expect(menu.getByRole("heading", { name: en["sheet.group"] })).toBeVisible();
  await expect(menu.getByRole("combobox", { name: en["language.label"] })).toHaveCount(0);
  await menu.getByRole("button", { name: en["common.close"] }).click();
  await expect(page.getByRole("combobox", { name: en["language.label"] })).toHaveCount(1);
  // The character is loaded again in the new language, without a reload.
  await chooseLanguage(page, "de");
  await expect(page.getByRole("button", { name: /^Kraft: \d+\. Ändern$/ })).toBeVisible();
  await expectOneLanguage(page, "de");
});
