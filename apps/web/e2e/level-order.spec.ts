/**
 * Findings of the first rules check (AND-108):
 *
 * - A step of the first level never stands under "From level 3"; the
 *   group's span reads from the lower level to the higher one (since AND-119
 *   the group lists it first).
 * - The overview names no thing twice in one "from" line.
 * - The last card of a long list is not under the Back / Next bar: tapping
 *   what is in view picks it.
 *
 * In German and English, on a phone (Pixel 7) and a desktop window.
 */
import type { Locator, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { join } from "node:path";
import { expect, SHOTS, signup, test } from "./helpers.ts";

const DESKTOP = {
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 900 },
};

const WORDS = {
  de: {
    m: de,
    herbCraft: "Kräuterhandwerk",
    path: "Spezialisierung",
    way: "Dein Weg",
    herbalist: "Kräuterkundige",
  },
  en: { m: en, herbCraft: "Herb craft", path: "Path", way: "Your way", herbalist: "Herbalist" },
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

/**
 * Opens the menu with the step list on the phone; taps again if the page was
 * not live yet. A tap while the character still loads opens the loading
 * screen's menu, which goes with that screen: only the step list in the menu
 * says it is open.
 */
async function openMenu(page: Page, m: typeof de) {
  const button = page.getByRole("button", { name: m["menu.open"] });
  const list = page.getByRole("dialog", { name: m["menu.title"] }).locator(".steplist");
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await expect(list).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** The level heading a step link stands under in the open group, or "" if none. */
async function headingOf(link: Locator): Promise<string> {
  return link.evaluate((a) => {
    const items = [...a.closest(".steplist__parts")!.querySelectorAll(":scope > li")];
    const own = a.closest("li")!;
    for (let i = items.indexOf(own); i >= 0; i--) {
      const h = items[i]!.querySelector(".steplist__level");
      if (h) return h.textContent ?? "";
    }
    return "";
  });
}

/**
 * The band where cards show: below the top bar (and a count stuck under it)
 * and above the Back / Next bar, fixed on phones and stuck on larger screens.
 */
function band(): { top: number; bottom: number } {
  const topbar = document.querySelector(".topbar")!.getBoundingClientRect().bottom;
  let top = topbar;
  for (const el of document.querySelectorAll(".pick-counter")) {
    const r = el.getBoundingClientRect();
    if (r.top <= topbar + 1 && r.bottom > top) top = r.bottom;
  }
  const dock = document.querySelector(".step-footer__dock")!;
  const footer = document.querySelector(".step-footer")!;
  const bar = getComputedStyle(dock).position === "fixed" ? dock : footer;
  return { top, bottom: Math.min(bar.getBoundingClientRect().top, window.innerHeight) };
}

/** Where a tap on the middle of what shows of a card lands: "ok" when on the card. */
async function tapLands(el: Locator): Promise<string> {
  return el.evaluate((card, fn) => {
    const b = (new Function(`return (${fn})`)() as () => { top: number; bottom: number })();
    const r = card.getBoundingClientRect();
    const top = Math.max(r.top, b.top);
    const bottom = Math.min(r.bottom, b.bottom);
    if (bottom - top < 8) return "ok";
    const hit = document.elementFromPoint(r.left + r.width / 2, (top + bottom) / 2);
    return hit && card.contains(hit) ? "ok" : `covered by ${hit?.className ?? "nothing"}`;
  }, band.toString());
}

/** How far the card reaches below the top of the Back / Next bar, in pixels (0 or less: clear of it). */
async function underBar(card: Locator): Promise<number> {
  return card.evaluate((el, fn) => {
    const b = (new Function(`return (${fn})`)() as () => { top: number; bottom: number })();
    return Math.round(el.getBoundingClientRect().bottom - b.bottom);
  }, band.toString());
}

for (const lang of ["de", "en"] as const) {
  const w = WORDS[lang];
  const m = w.m;
  const levelWord = lang === "de" ? "Stufe" : "Level";

  for (const device of ["phone", "desktop"] as const) {
    test.describe(`${lang} ${device}`, () => {
      if (device === "desktop") test.use(DESKTOP);
      const shot = (page: Page, name: string, fullPage = false) =>
        page.screenshot({
          path: join(SHOTS, `108-${name}-${device}-${lang}.png`),
          fullPage,
          animations: "disabled",
        });

      test("a step of the first level never stands under a higher level", async ({ page, foreign }) => {
        void foreign;
        await signup(page, `order-${lang}`, lang);
        const id = await herbalist(page);
        await page.goto(`/c/${id}/step/path`);
        if (device === "phone") await openMenu(page, m);
        const list = page.locator(".steplist").locator("visible=true").first();
        // The group: its name, and the span from the lower level to the higher one.
        const group = list.getByRole("link", { name: new RegExp(`^${w.way}`) });
        await expect(group).toContainText(
          new RegExp(`${levelWord} 1 ${lang === "de" ? "bis" : "to"} 3`, "i"),
        );
        // The level-1 part comes first with no heading, the level-3 part after it under "From level 3" (AND-119).
        const path = list.getByRole("link", { name: new RegExp(`^${w.path}`) });
        const craft = list.getByRole("link", { name: new RegExp(`^${w.herbCraft}`) });
        await expect(craft).toBeVisible();
        expect(await headingOf(path)).toMatch(
          new RegExp(`^${lang === "de" ? "Ab Stufe" : "From level"} 3$`, "i"),
        );
        expect(await headingOf(craft)).toBe("");
        await shot(page, "schrittliste");

        // On the level-1 part itself: its heading names no level.
        await page.goto(`/c/${id}/step/herb-craft`);
        await expect(page.locator(".progress__text")).toContainText(w.way);
        await expect(page.locator(".progress__text")).not.toContainText(new RegExp(`${levelWord} 3`, "i"));
      });

      test("the overview names nothing twice in one line", async ({ page, foreign }) => {
        void foreign;
        await signup(page, `twice-${lang}`, lang);
        const id = await herbalist(page);
        await page.goto(`/c/${id}/overview`);
        const lines = page.locator(".origins__things");
        await expect(lines.first()).toBeVisible();
        for (const line of await lines.all()) {
          const words = (await line.innerText()).split(/, | und | and /).map((x) => x.trim());
          expect(new Set(words).size, await line.innerText()).toBe(words.length);
        }
        await page.locator(".origins").scrollIntoViewIfNeeded();
        await shot(page, "ueberblick");
      });

      test("the last card of a long list is not under the Back / Next bar", async ({ page, foreign }) => {
        void foreign;
        await signup(page, `dock-${lang}`, lang);
        const id = await herbalist(page);
        await page.goto(`/c/${id}/step/knacks`);
        const cards = page.locator(".step__content .option");
        await expect(cards.last()).toBeAttached();
        // At the end of the list, the last card stands fully above the bar.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const last = cards.last();
        expect(await underBar(last)).toBeLessThanOrEqual(0);
        expect(await tapLands(last)).toBe("ok");
        await shot(page, "letzte-karte");
        // Every card takes a tap where it shows, wherever the page stands.
        for (const y of [600, 1200, 1800]) {
          await page.evaluate((to) => window.scrollTo(0, to), y);
          for (const card of await cards.all()) expect(await tapLands(card)).toBe("ok");
        }
        // A card brought into view (a tap, a jump) or reached with the keyboard stands above the bar.
        const mid = cards.nth(Math.floor((await cards.count()) / 2));
        await page.evaluate(() => window.scrollTo(0, 0));
        await mid.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
        expect(await underBar(mid)).toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await last.locator(".option__input").focus();
        expect(await underBar(last)).toBeLessThanOrEqual(0);
        // Playwright's own tap, which scrolls as little as it can, picks the card at once.
        await page.evaluate(() => window.scrollTo(0, 0));
        await mid.locator(".option__name").click({ timeout: 3000 });
        await expect(mid.locator(".option__input")).toBeChecked();
      });
    });
  }
}
