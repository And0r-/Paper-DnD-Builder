/**
 * What an answer does to the steps shows in the step list itself (AND-96):
 * a step that comes is green for a moment, a step that goes is red, struck
 * through, and then gone. No sentence above the question; screen readers
 * hear one short sentence. On phones, where the list is shut in the menu,
 * the menu button and "Step x of y" show it in the same colours.
 */
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { join } from "node:path";
import { expect, login, SHOTS, test, uniqueEmail } from "./helpers.ts";

/** A desktop window: wide enough for the step list beside the question. */
const DESKTOP = { isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

async function newDraft(page: Page): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  const view = (await created.json()) as { draft: { id: string; version: number } };
  const res = await page.request.patch(`/api/drafts/${view.draft.id}`, {
    data: { version: view.draft.version, level: 1 },
  });
  expect(res.status()).toBe(200);
  return view.draft.id;
}

/**
 * A photo with the colour as it stands: a full-page photo starts the
 * slide-in over, so it is shown at its end.
 */
async function still(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true, animations: "disabled" });
}

/** Picks an option of the current step; confirms the "change?" question if one comes. */
async function pick(page: Page, name: string) {
  await page.getByRole("main").getByText(name, { exact: true }).click();
  const confirm = page.getByRole("button", { name: m["change.confirm"] });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

test.describe("large screens", () => {
  test.use({ ...DESKTOP, viewport: { width: 1366, height: 900 } });

  test("a step that comes is green, a step that goes is red and then gone", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("steps-come-go"));
    const id = await newDraft(page);
    await page.goto(`/c/${id}/step/calling`);
    const list = page.getByRole("navigation", { name: m["flow.steps"] });
    await expect(list).toBeVisible();
    // Arriving on a step marks nothing.
    await expect(list.locator("[data-mark]")).toHaveCount(0);

    // The other calling brings a step of its own.
    await pick(page, "Flussläufer");
    const added = list.locator("[data-mark='new']");
    await expect(added.first()).toBeVisible();
    const came = (await added.allInnerTexts()).map((s) => s.split("\n")[0]!.trim());
    expect(came.length).toBeGreaterThan(0);
    await expect(added.first()).toHaveCSS("box-shadow", /rgb\(29, 107, 58\)/);
    // No note box above the question any more.
    await expect(page.locator(".step .callout")).toHaveCount(0);
    await still(page, "96-schritt-kommt-gruen");
    // After about 2.5 seconds the step stands as any other.
    await expect(added).toHaveCount(0, { timeout: 4000 });
    for (const title of came) await expect(list.getByRole("link", { name: title })).toBeVisible();

    await pick(page, "Laternenträgerin");
    const gone = list.locator("[data-gone]");
    await expect(gone.first()).toBeVisible();
    await expect(gone.first().locator(".steplist__link--gone")).toHaveCSS("box-shadow", /rgb\(168, 36, 28\)/);
    // Back to the first calling: its own step goes again.
    const went = (await gone.allInnerTexts()).map((s) => s.trim());
    expect(went.some((w) => came.includes(w))).toBe(true);
    await still(page, "96-schritt-geht-rot");
    // Then they fold away and are gone.
    await expect(gone).toHaveCount(0, { timeout: 5000 });
    for (const title of went)
      await expect(list.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  });
});

test("phones: the shut menu and the count show it, a screen reader hears it", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("steps-phone"));
  const id = await newDraft(page);
  await page.goto(`/c/${id}/step/calling`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const total = page.locator(".progress__text .progress__count").first();
  await expect(total).not.toHaveAttribute("data-mark");

  // The suggested pick: steps come into the list, the count stands, nothing to say.
  await pick(page, "Laternenträgerin");
  const mark = page.locator(".topbar__menu .menu-mark__count--new");
  await expect(mark).toBeVisible();
  await expect(mark).toHaveText(/^\+\d+$/);
  await expect(total).not.toHaveAttribute("data-mark");
  await expect(page.locator(".step-notice")).toHaveText("");
  await expect(mark).toHaveCount(0, { timeout: 4000 });

  // A pick that brings one more step: the count turns green, one sentence for screen readers.
  await pick(page, "Flussläufer");
  await expect(total).toHaveAttribute("data-mark", "new");
  await expect(page.locator(".step-notice")).toHaveText(/^Ein Schritt dazu: .+\.$/);
  await expect(page.locator(".step-notice")).not.toBeInViewport();
  await still(page, "96-handy-menue-und-zahl");
  await expect(total).not.toHaveAttribute("data-mark", { timeout: 4000 });

  // Back to the first pick: the count turns red.
  await pick(page, "Laternenträgerin");
  await expect(total).toHaveAttribute("data-mark", "lost");
  await expect(page.locator(".step-notice")).toHaveText(/^Ein Schritt fällt weg: .+\.$/);
  await expect(page.locator(".topbar__menu .menu-mark__count--gone")).toHaveText(/^−\d+$/);
});

test.describe("reduced motion", () => {
  test.use({ ...DESKTOP, viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });

  test("the colours without movement", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("steps-still"));
    const id = await newDraft(page);
    await page.goto(`/c/${id}/step/calling`);
    const list = page.getByRole("navigation", { name: m["flow.steps"] });
    await pick(page, "Flussläufer");
    const added = list.locator("[data-mark='new']").first();
    await expect(added).toBeVisible();
    await expect(added).toHaveCSS("animation-name", "none");
    await expect(added).toHaveCSS("transition-duration", "0s");
    await pick(page, "Laternenträgerin");
    await expect(list.locator("[data-gone]").first()).toBeVisible();
    await expect(list.locator("[data-gone]")).toHaveCount(0, { timeout: 5000 });
  });
});
