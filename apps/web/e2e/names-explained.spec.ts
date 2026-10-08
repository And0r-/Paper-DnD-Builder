/**
 * Common names stay, with one sentence on hover, keyboard focus and tap
 * (AND-87): the builder's name in the top bar, "PDF" on the done screen,
 * and the names of things where their text is not on screen.
 */
import { devices, type Locator, type Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { join } from "node:path";
import { expect, expectOneLanguage, makeCharacter, SHOTS, signup, test } from "./helpers.ts";

const MESSAGES = { de, en };
const CALLING = {
  de: { name: "Laternenträgerin", short: "Du bringst Licht ins Dunkel und hältst die Gruppe zusammen." },
};

/** What the screen shows right now: the explanation floats, so no full-page picture. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The explanation a trigger points to. */
async function hintOf(page: Page, trigger: Locator): Promise<Locator> {
  const id = await trigger.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

/**
 * The explanation lies inside the screen and never catches a tap: a tap on
 * whatever lies under it reaches that. With `strict`, nothing tappable is
 * under it at all.
 */
async function expectInsideAndFree(page: Page, hint: Locator, strict = true) {
  const box = (await hint.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  const covered = await hint.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...document.querySelectorAll("button, a")].filter((b) => {
      if (el.contains(b) || b.closest(".term, .explained")) return false;
      const o = b.getBoundingClientRect();
      if (o.width === 0 || o.height === 0) return false;
      return o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top;
    }).length;
  });
  const taps = await hint.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return getComputedStyle(el).pointerEvents === "none" && !el.contains(under);
  });
  expect(taps, "a tap goes through the explanation").toBe(true);
  if (strict) expect(covered, "buttons or links under the explanation").toBe(0);
}

test.describe("phone", () => {
  // The smallest phone the plan names.
  test.use({ viewport: { width: 360, height: 780 } });

  for (const lang of ["de", "en"] as const) {
    test(`tap shows the sentence, a second tap or a tap elsewhere hides it (${lang})`, async ({
      page,
      foreign,
    }) => {
      void foreign;
      const m = MESSAGES[lang];
      await signup(page, `names-${lang}`, lang);
      const id = await makeCharacter(page);

      // The top bar: the name stays a link, the info button next to it explains it.
      await page.goto("/settings");
      const link = page.locator(".topbar__title").getByRole("link", { name: m["app.name"] });
      await expect(link).toBeVisible();
      const info = page.locator(".topbar__title").getByRole("button", { name: m["common.whatIsThis"] });
      const appHint = await hintOf(page, info);
      await expect(appHint).toBeHidden();
      await info.tap();
      await expect(appHint).toBeVisible();
      await expect(appHint).toHaveText(m["app.about"]);
      await expectInsideAndFree(page, appHint);
      await shot(page, `87-kopfzeile-handy-${lang}`);
      await info.tap();
      await expect(appHint).toBeHidden();
      await info.tap();
      await page.locator("main h1").tap();
      await expect(appHint).toBeHidden();
      // The link still leads to the list.
      await link.tap();
      await expect(page).toHaveURL(/\/characters$/);

      // "PDF" on the done screen.
      await page.goto(`/c/${id}/done`);
      const pdfButton = page.getByRole("button", { name: m["done.download"] });
      await expect(pdfButton).toBeVisible();
      const pdfHint = await hintOf(page, pdfButton);
      await page.locator(".done__pdf").getByRole("button", { name: m["common.whatIsThis"] }).tap();
      await expect(pdfHint).toBeVisible();
      await expect(pdfHint).toHaveText(m["done.pdfHint"]);
      await expectInsideAndFree(page, pdfHint);
      await shot(page, `87-pdf-handy-${lang}`);

      // A name from the package on the overview: a tap puts its first sentence
      // under it, in the text; no bubble covers the lines below (AND-90).
      await page.goto(`/c/${id}/overview`);
      const name = page.locator(".summary .term").last();
      const word = name.locator(".term__word");
      await expect(word).toBeVisible();
      const nameHint = await hintOf(page, word);
      await word.tap();
      await expect(name.locator(".term__inline")).toBeVisible();
      await expect(name.locator(".term__inline")).toHaveText((await nameHint.textContent()) ?? "");
      await expect(nameHint).toBeHidden();
      if (lang === "de") {
        const calling = page.locator(".summary .term", { hasText: CALLING.de.name });
        await calling.locator(".term__word").tap();
        await expect(calling.locator(".term__inline")).toHaveText(CALLING.de.short);
        await expect(name.locator(".term__inline")).toBeHidden();
      }
      await expectOneLanguage(page, lang);
      await expect(page.locator(".hint--shown")).toHaveCount(0);
      await expect(page.locator(".term__inline")).toHaveCount(1);
      await shot(page, `87-ueberblick-handy-${lang}`);
    });
  }
});

// The browser stays as configured; only the screen becomes a desktop one with a mouse.
const { defaultBrowserType: _browser, ...desktop } = devices["Desktop Chrome"];

test.describe("mouse and keyboard", () => {
  test.use({ ...desktop, viewport: { width: 1366, height: 900 } });

  test("hover and keyboard focus show the sentence, Escape hides it", async ({ page, foreign }) => {
    void foreign;
    await signup(page, "names-desk");
    const id = await makeCharacter(page);

    await page.goto("/settings");
    const link = page.locator(".topbar__title").getByRole("link", { name: de["app.name"] });
    const appHint = await hintOf(page, link);
    await link.hover();
    await expect(appHint).toBeVisible();
    await expect(appHint).toHaveText(de["app.about"]);
    await shot(page, "87-kopfzeile-maus-de");
    await page.mouse.move(700, 600);
    await expect(appHint).toBeHidden();

    await page.goto(`/c/${id}/done`);
    const pdfButton = page.getByRole("button", { name: de["done.download"] });
    const pdfHint = await hintOf(page, pdfButton);
    await pdfButton.hover();
    await expect(pdfHint).toHaveText(de["done.pdfHint"]);
    await expect(pdfHint).toBeVisible();
    await shot(page, "87-pdf-maus-de");
    await page.mouse.move(10, 600);
    await expect(pdfHint).toBeHidden();

    await page.goto(`/c/${id}/overview`);
    const calling = page.locator(".summary .term__word", { hasText: CALLING.de.name });
    const callingHint = await hintOf(page, calling);
    await calling.hover();
    await expect(callingHint).toHaveText(CALLING.de.short);
    await shot(page, "87-ueberblick-maus-de");
    await page.mouse.move(10, 10);
    await expect(callingHint).toBeHidden();

    // Keyboard: focus shows it, Escape hides it.
    await calling.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(callingHint).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(callingHint).toBeHidden();
  });
});
