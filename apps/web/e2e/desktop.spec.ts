/**
 * Large screens: step list left, question in the middle, the explanation
 * of the focused option on the right (design system 3). Plus the whole
 * step done with the keyboard only, and a log of every request the browser
 * made (done criterion 4).
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, makeCharacter, SHOTS, shot, test, uniqueEmail } from "./helpers.ts";

test.use({ ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } });

test("three columns, keyboard only, and only requests to the builder itself", async ({
  page,
  foreign,
  baseURL,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));

  await login(page, uniqueEmail("desk"));
  const id = await makeCharacter(page, false);

  await page.goto(`/c/${id}/step/calling`);
  await expect(page.getByRole("navigation", { name: m["flow.steps"] })).toBeVisible();
  await page.getByRole("main").getByText("Kräuterkundige", { exact: true }).hover();
  await expect(page.locator(".explain-panel")).toContainText("Kräuterkundige");
  await shot(page, "40-desktop-beruf");

  // Keyboard only: arrow keys move through the options, Enter on Next goes on.
  await page.getByRole("radio", { name: "Laternenträgerin" }).focus();
  await page.keyboard.press("ArrowDown");
  const dialog = page.getByRole("dialog", { name: "Beruf ändern?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: m["change.keep"] })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radio", { name: "Laternenträgerin" })).toBeChecked();
  // Focus goes back into the option group, where the keyboard user was.
  await expect(page.locator("input[name='choice-calling']:focus")).toHaveCount(1);
  await page.getByRole("button", { name: m["common.next"], exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Was nimmt dein Charakter zusätzlich mit?" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  // Flow screens focus their question on arrival (screen readers start there).
  await page.goto(`/c/${id}/overview`);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await shot(page, "41-desktop-ueberblick");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  // On a page that leaves focus alone, the first Tab stop is the skip link.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: m["settings.title"] })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: m["common.skipToContent"] })).toBeFocused();
  await shot(page, "42-desktop-einstellungen");

  const own = new URL(baseURL!).origin;
  await writeFile(
    join(SHOTS, "network-log.txt"),
    [
      `Origin of the builder: ${own}`,
      `Requests: ${requests.length}`,
      `Requests to other origins: ${foreign.length}`,
      "",
      ...requests,
    ].join("\n"),
  );
});

/** True if the whole element lies inside the visible part of the page. */
async function expectInView(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const view = page.viewportSize()!;
  expect(box, "element is rendered").not.toBeNull();
  expect(box!.y, "top edge in view").toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, "bottom edge in view").toBeLessThanOrEqual(view.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
}

/** The focused element is in view and nothing sticky (top bar, counter, dock) covers it. */
async function expectFocusSeen(page: Page) {
  const seen = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "nothing focused";
    if ((el as HTMLInputElement).type === "search") return "focus on the search box";
    const card = el.closest<HTMLElement>("[data-option]") ?? el;
    const r = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 24));
    return hit && card.contains(hit) ? "ok" : `covered by ${hit?.className ?? "nothing"}`;
  });
  expect(seen).toBe("ok");
}

test("Next pressed too early: reason, Choose for me and focus are all in view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, uniqueEmail("early"));
  // A level-3 herbalist: every kind of step, and a list long enough for a search box.
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await page.request.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  await page.request.put(`/api/drafts/${id}/answers/calling`, {
    data: { version: view.draft.version, answer: { pick: "calling.herbalist" } },
  });

  const next = page.getByRole("button", { name: m["common.next"], exact: true });
  const reason = page.locator(".step-footer__reason");
  const chooseForMe = reason.getByRole("button", { name: m["flow.chooseForMe"] });

  // The long list: 14 cards, a search box, the page scrolls far.
  await page.goto(`/c/${id}/step/borrowed-knack`);
  await expect(page.getByRole("searchbox", { name: m["pick.search"] })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(2 * 900);
  await next.scrollIntoViewIfNeeded();
  await next.click();
  await expect(reason).toContainText("Wähle noch 1 Kniff.");
  await page.screenshot({ path: join(SHOTS, "43-desktop-zu-frueh-weiter.png") });
  await expectInView(page, reason);
  await expectInView(page, chooseForMe);
  await expectInView(page, next);
  await expectFocusSeen(page);
  await chooseForMe.click();
  await expect(page.getByText("1 von 1 gewählt")).toBeVisible();
  await expect(reason).toHaveCount(0);

  // The same for one pick, many picks without search, and points to share out.
  for (const step of ["folk", "talents-herbalist", "scores"]) {
    await page.goto(`/c/${id}/step/${step}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await next.click();
    await expect(reason, step).toBeVisible();
    await expectInView(page, reason);
    await expectInView(page, chooseForMe);
    await expectFocusSeen(page);
  }
});
