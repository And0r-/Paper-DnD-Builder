/**
 * "Choose for me" is in view before Next is ever pressed, under the intro,
 * on phones and large screens. A click fills the step and the step shows
 * what was set: for points to share out, the way and every number.
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, type Page } from "@playwright/test";
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

async function checkScores(page: Page, name: string) {
  await login(page, uniqueEmail(name));
  const id = await openScores(page);
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Worin ist dein Charakter stark?" }),
  ).toBeFocused();

  // Before any Next: the button is there, in view, with what it does next to it.
  const button = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
  await expect(button).toBeInViewport({ ratio: 1 });
  await expect(page.getByText(m["flow.chooseForMeHint"])).toBeVisible();
  await expect(page.locator(".step-footer__reason")).toHaveCount(0);
  await expect(page.getByText("14 Punkte übrig", { exact: true })).toBeVisible();

  // Someone tried the other way first; the suggestion still sets its own.
  await page.getByText(m["dist.array"], { exact: true }).click();
  await shot(page, `${name}-vorher`);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  await button.click();

  // The step shows what was set: the way, the four numbers, the points left.
  await expect(page.locator(".shortcuts__done")).toBeFocused();
  await expect(page.locator(".shortcuts__done")).toContainText(m["flow.choseForMe"]);
  await expect(page.getByRole("radio", { name: m["dist.pointBuy"] })).toBeChecked();
  await expect(page.locator(".stepper__value")).toHaveText(["8", "7", "9", "11"]);
  await expect(page.getByText("2 Punkte übrig", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: m["flow.chooseForMe"] })).toHaveCount(0);
  await shot(page, `${name}-nachher`);

  // Still yours to change.
  await page.getByRole("button", { name: "Kraft erhöhen" }).click();
  await expect(page.locator(".stepper__value").first()).toHaveText("9");
  await expect(page.getByText("1 Punkt übrig", { exact: true })).toBeVisible();

  // And it is saved: a fresh visit shows the same numbers.
  await page.reload();
  await expect(page.locator(".stepper__value")).toHaveText(["9", "7", "9", "11"]);

  // The last point spent: a calm "all spent", no warning before anyone tries for more.
  await page.getByRole("button", { name: "Kraft erhöhen" }).click();
  await expect(page.getByText(m["dist.allSpent"])).toBeVisible();
  await expect(page.locator(".pointbuy__hint")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kraft erhöhen" })).toHaveAttribute("aria-disabled", "true");
  await shot(page, `${name}-alle-punkte`);
  // Trying anyway (aria-disabled still takes the tap) says why and what to do.
  await page.getByRole("button", { name: "Kraft erhöhen" }).click({ force: true });
  await expect(page.getByText(m["dist.notEnough"])).toBeVisible();
  await expect(page.locator(".stepper__value").first()).toHaveText("10");
}

test("phone: Choose for me is there before Next and shows what it set", async ({ page }) => {
  await checkScores(page, "50-handy-fuer-mich-waehlen");
});

test.describe("large screens", () => {
  const { defaultBrowserType: _, ...desktop } = devices["Desktop Chrome"];
  test.use({ ...desktop, viewport: { width: 1366, height: 900 } });

  test("desktop: Choose for me is there before Next and shows what it set", async ({ page }) => {
    await checkScores(page, "51-desktop-fuer-mich-waehlen");
  });
});
