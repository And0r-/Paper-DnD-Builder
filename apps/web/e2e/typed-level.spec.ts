/**
 * A level typed into the number field counts at once (AND-89): the button,
 * the hint and the top bar name the typed level on every key, as they do
 * for − and +, not only once the field is left. Wrong input is marked and
 * cut back to the range on leaving, as before.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, makeLeveled, raiseGo, shot, signup, test } from "./helpers.ts";

test("new build: a typed level stands in the top bar before Next", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "typed-level");
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  const level = page.locator(".topbar__character");
  await expect(level).toContainText("Stufe 1");

  // Typed key by key, no Enter, no leaving the field.
  await field.selectText();
  await field.pressSequentially("20");
  await expect(level).toContainText("Stufe 20");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("20");
  await shot(page, "100-stufe-getippt-neu");

  // "12" goes through "1", which may still grow: it waits for the next key, then counts.
  await field.selectText();
  await field.pressSequentially("12");
  await expect(level).toContainText("Stufe 12");
  await field.selectText();
  await field.pressSequentially("7");
  await expect(level).toContainText("Stufe 7");

  // Over the top: marked wrong, the top bar keeps the last level; leaving the field cuts it to 20.
  await field.selectText();
  await field.pressSequentially("25");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(level).toContainText("Stufe 7");
  await field.press("Tab");
  await expect(field).toHaveValue("20");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(level).toContainText("Stufe 20");
});

test("level up: the button and the hint name the typed level at once", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "typed-raise");
  const id = await makeLeveled(page, 3);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { version: number };
  };
  expect(
    (await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } })).status(),
  ).toBe(200);

  await page.goto(`/c/${id}/done`);
  await page.getByRole("link", { name: m["raise.button"] }).click();
  await page.getByRole("radio", { name: "Andere Stufe" }).check();
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  await expect(field).toHaveValue("5");
  await page.getByRole("button", { name: "Stufe tiefer" }).click();
  await expect(page.getByRole("button", { name: "Weiter zu Stufe 4" })).toBeVisible();

  // Typed, not stepped: 4 → 5 without leaving the field.
  await field.selectText();
  await field.pressSequentially("5");
  await expect(field).toBeFocused();
  await expect(page.getByRole("button", { name: "Weiter zu Stufe 5" })).toBeVisible();
  await expect(page.getByText("auf dem Weg bis Stufe 5 neu dazukommt", { exact: false })).toBeVisible();
  await shot(page, "101-stufe-getippt-aufstufen");

  // "12" goes through "1", below the next level: not marked wrong on the way.
  await field.selectText();
  await field.press("1");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await field.press("2");
  await expect(page.getByRole("button", { name: "Weiter zu Stufe 12" })).toBeVisible();

  // Below the next level and no start of a higher one: marked wrong, cut back on leaving.
  await field.selectText();
  await field.pressSequentially("3");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Weiter zu Stufe 12" })).toBeVisible();
  await field.press("Tab");
  await expect(field).toHaveValue("4");
  await expect(page.getByRole("button", { name: "Weiter zu Stufe 4" })).toBeVisible();

  // The typed level is the one the raise goes to.
  await field.selectText();
  await field.pressSequentially("5");
  await raiseGo(page, "Weiter zu Stufe 5");
  await expect(page.locator(".progress__text")).toContainText("Schritt 1 von");
  await expect(page.locator(".topbar__character")).toContainText("Stufe 5");
});
