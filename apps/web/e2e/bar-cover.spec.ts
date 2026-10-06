/**
 * Findings of the second rules check (AND-119):
 *
 * - The Back / Next bar never lies over a card of a step that fits the
 *   window, nor over its focus ring.
 * - A card the bar cuts off takes a tap on what shows of it, and on the
 *   empty part of the bar over it; the card it picks comes fully into view.
 * - The steps of a group in the step list stand from the lowest level up.
 *
 * On a phone (390 × 844) and a desktop window (1280 × 900).
 */
import type { Locator, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import { join } from "node:path";
import { expect, login, SHOTS, test, uniqueEmail } from "./helpers.ts";

const SIZES = {
  phone: { viewport: { width: 390, height: 844 } },
  desktop: { isMobile: false, hasTouch: false, deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } },
} as const;

/** A level-3 herbalist with the given answers, made through the API. */
async function herbalist(page: Page, answers: Record<string, unknown> = {}): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  const level = await page.request.patch(`/api/drafts/${id}`, {
    data: { version: view.draft.version, level: 3 },
  });
  view = await level.json();
  for (const [choice, answer] of Object.entries({ calling: { pick: "calling.herbalist" }, ...answers })) {
    const res = await page.request.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(res.status(), choice).toBe(200);
    view = await res.json();
  }
  return id;
}

/** The top edge of the Back / Next bar: the dock fixed on phones, the whole footer stuck on larger screens. */
function barTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const dock = document.querySelector(".step-footer__dock")!;
    const bar = getComputedStyle(dock).position === "fixed" ? dock : document.querySelector(".step-footer")!;
    return bar.getBoundingClientRect().top;
  });
}

/** The bottom edge of a card with its focus ring (outline and its offset) and its shadow. */
function outerBottom(card: Locator): Promise<number> {
  return card.evaluate((el) => {
    const s = getComputedStyle(el);
    const ring = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    return el.getBoundingClientRect().bottom + Math.max(ring, 0);
  });
}

for (const device of ["phone", "desktop"] as const) {
  test.describe(device, () => {
    test.use(SIZES[device]);
    const shot = (page: Page, name: string) =>
      page.screenshot({ path: join(SHOTS, `119-${name}-${device}.png`), animations: "disabled" });

    test("a step that fits the window has no card under the bar", async ({ page, foreign }) => {
      void foreign;
      await login(page, uniqueEmail(`fits-${device}`));
      const id = await herbalist(page);
      await page.goto(`/c/${id}/step/herb-craft`);
      const cards = page.locator(".step__content .option");
      await expect(cards).toHaveCount(2);
      if (device === "desktop") {
        // The step fits with its bar (the step list beside it may be longer), so the bar does not stick over the cards.
        expect(
          await page.evaluate(() => document.querySelector(".step")!.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
      } else {
        // No step of the demo package fits a phone without scrolling; at the end of the page it stands as one that fits would.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      }
      const last = cards.last();
      expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThan(
        await barTop(page),
      );
      // With the keyboard: the focus ring of the last card stays clear of the bar too.
      await last.locator(".option__input").focus();
      await page.keyboard.press("Space");
      await expect(last.locator(".option__input")).toBeChecked();
      expect(await outerBottom(last)).toBeLessThan(await barTop(page));
      await shot(page, "passt-ins-fenster");
    });

    test("a card the bar cuts off takes a tap and comes into view", async ({ page, foreign }) => {
      void foreign;
      await page.emulateMedia({ reducedMotion: "reduce" });
      await login(page, uniqueEmail(`cut-${device}`));
      const id = await herbalist(page);
      await page.goto(`/c/${id}/step/knacks`);
      const cards = page.locator(".step__content .option");
      await expect(cards.last()).toBeAttached();
      // The page stands so that the bar cuts the third card in half.
      const card = cards.nth(2);
      const top = await barTop(page);
      await card.evaluate((el, edge) => {
        const r = el.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + r.top + r.height / 2 - edge);
      }, top);
      expect(await card.evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThan(
        await barTop(page),
      );
      const box = (await card.boundingBox())!;
      await shot(page, "karte-angeschnitten");
      if (device === "desktop") {
        // A tap on the bar's empty middle, right over the card, picks it.
        const bar = (await page.locator(".step-footer__bar").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, bar.y + bar.height / 2);
      } else {
        // A tap on what shows of the card, just above the bar, picks it.
        await page.mouse.click(box.x + box.width / 2, top - 12);
      }
      await expect(card.locator(".option__input")).toBeChecked();
      // The card it picked stands fully above the bar.
      await expect(async () => {
        const r = (await card.boundingBox())!;
        expect(r.y + r.height).toBeLessThanOrEqual(await barTop(page));
        expect(r.y).toBeGreaterThan(0);
      }).toPass();
      await shot(page, "karte-gewaehlt");
    });

    test("the steps of a group stand from the lowest level up", async ({ page, foreign }) => {
      void foreign;
      await login(page, uniqueEmail(`up-${device}`));
      const id = await herbalist(page);
      await page.goto(`/c/${id}/step/path`);
      if (device === "phone") {
        const button = page.getByRole("button", { name: de["menu.open"] });
        await expect(async () => {
          await button.click();
          await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
        }).toPass();
      }
      const parts = page.locator(".steplist").locator("visible=true").first().locator(".steplist__parts");
      await expect(parts).toBeVisible();
      // The level each step stands under, in the order of the list.
      const levels = await parts.evaluate((ol) => {
        let level = 1;
        return [...ol.querySelectorAll(":scope > li")].map((li) => {
          const h = li.querySelector(".steplist__level")?.textContent;
          if (h) level = Number(/\d+/.exec(h)![0]);
          return level;
        });
      });
      expect(levels.length).toBeGreaterThan(1);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      // The level-1 part first, then the level-3 one, under "From level 3"; the bar of the group reads 1 to 3.
      const names = await parts.locator(".steplist__link .steplist__name").allInnerTexts();
      expect(names.findIndex((n) => n.startsWith("Kräuterhandwerk"))).toBeLessThan(
        names.findIndex((n) => n.startsWith("Spezialisierung")),
      );
      await shot(page, "schrittliste");
    });
  });
}
