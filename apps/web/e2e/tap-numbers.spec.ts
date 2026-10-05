/**
 * Fixed numbers are given out by tapping, never with dropdowns. The step
 * says which number goes next, an early Next names what is missing, the
 * lowest number fills the last row by itself, and a tap takes a number
 * back. "Choose for me" is there from the start.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, shot, test, uniqueEmail } from "./helpers.ts";

/** A level-3 lantern bearer whose scores are still open. */
async function openScores(page: Page): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await page.request.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  await page.request.put(`/api/drafts/${id}/answers/calling`, {
    data: { version: view.draft.version, answer: { pick: "calling.lantern-bearer" } },
  });
  return id;
}

const row = (page: Page, name: string) => page.locator(".array-assign__row", { hasText: name });
const hit = (page: Page, name: string) => row(page, name).locator(".array-assign__hit");
const status = (page: Page) => page.locator(".array-assign__status");

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
}

test("fixed numbers: tap to give, tap to take back, no dropdowns", async ({ page }) => {
  await login(page, uniqueEmail("tap-numbers"));
  const id = await openScores(page);
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Worin ist dein Charakter stark?" }),
  ).toBeFocused();

  // "Choose for me" is there before anything is touched.
  await expect(page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] })).toBeVisible();

  // The other way: the numbers to give, and which one goes next. No dropdown anywhere.
  await page.getByText(m["dist.array"], { exact: true }).click();
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.locator(".array-assign__tray")).toContainText("Zu vergeben:");
  await expect(status(page)).toHaveText("Wohin kommt die 11? Tippe auf einen Wert unten.");
  await shot(page, "60-zahlen-antippen-start");
  await axe(page);

  // Next too early: the yellow reason, and focus on the first row still open.
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
  await expect(page.locator(".step-footer__reason")).toContainText(m["dist.arrayMissing"]);
  await expect(hit(page, "Kraft")).toBeFocused();

  // A tap gives the highest free number; the next one is named.
  await row(page, "Klugheit").click();
  await expect(hit(page, "Klugheit")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "Klugheit").locator(".array-assign__value")).toHaveText("11");
  await expect(status(page)).toHaveText("Wohin kommt die 10? Tippe auf einen Wert unten.");
  await shot(page, "61-zahlen-antippen-eins");

  // Keyboard works the same way.
  await hit(page, "Geschick").focus();
  await page.keyboard.press("Enter");
  await expect(row(page, "Geschick").locator(".array-assign__value")).toHaveText("10");
  await row(page, "Kraft").click();

  // The lowest number goes to the last row by itself: done, saved, the reason gone.
  await expect(page.locator(".array-assign__row--fixed", { hasText: "Herz" })).toContainText("7");
  await expect(status(page)).toHaveText(m["dist.tapDone"]);
  await expect(page.locator(".step-footer__reason")).toHaveCount(0);
  await expect(page.getByText("Gespeichert ✓")).toBeVisible();
  await shot(page, "62-zahlen-antippen-fertig");
  await axe(page);

  // It is saved: a fresh visit shows the same numbers.
  await page.reload();
  await expect(page.locator(".array-assign__value")).toHaveText(["9", "10", "11", "7"]);

  // A tap takes a number back; the step is open again and says so.
  await row(page, "Geschick").click();
  await expect(hit(page, "Geschick")).toHaveAttribute("aria-pressed", "false");
  await expect(status(page)).toHaveText("Wohin kommt die 10? Tippe auf einen Wert unten.");
  await expect(page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] })).toBeVisible();
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
  await expect(page.locator(".step-footer__reason")).toBeVisible();
  await expect(hit(page, "Geschick")).toBeFocused();

  // "Choose for me" fills the whole step with the package's suggestion.
  await page.locator(".step-footer").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.getByRole("radio", { name: m["dist.pointBuy"] })).toBeChecked();
  await expect(page.locator(".stepper__value")).toHaveText(["8", "7", "9", "11"]);
});
