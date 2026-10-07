/**
 * What a newcomer still missed (AND-90): the builder's name explained on the
 * login page too, a tapped name explained in the text instead of on top of
 * the lines below, the things the character already has explaining
 * themselves like the options, and every choice an earlier choice brought
 * saying where it comes from.
 */
import type { Locator, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  chooseLanguage,
  expect,
  expectOneLanguage,
  login,
  makeCharacter,
  shot,
  test,
  uniqueEmail,
} from "./helpers.ts";

const MESSAGES = { de, en };

/** The explanation a trigger points to. */
async function hintOf(page: Page, trigger: Locator): Promise<Locator> {
  const id = await trigger.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

/** Nothing with text on the screen lies under or over `el`: it stands in the flow of the text. */
async function expectNothingCovered(el: Locator) {
  const overlaps = await el.evaluate((me) => {
    const r = me.getBoundingClientRect();
    return [...document.querySelectorAll("main :is(p, h1, h2, h3, li, button, a, label)")]
      .filter((o) => !o.contains(me) && !me.contains(o))
      .filter((o) => {
        const b = o.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        return b.left < r.right && b.right > r.left && b.top < r.bottom - 1 && b.bottom > r.top + 1;
      })
      .map((o) => o.textContent?.trim().slice(0, 40));
  });
  expect(overlaps, "text under the explanation").toEqual([]);
}

test.describe("phone", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  for (const lang of ["de", "en"] as const) {
    test(`the login page explains the builder's name like the top bar (${lang})`, async ({
      page,
      foreign,
    }) => {
      void foreign;
      const m = MESSAGES[lang];
      await page.goto("/login");
      if (lang === "en") await chooseLanguage(page, "en");
      await expect(page.getByRole("heading", { name: m["login.title"] })).toBeVisible();
      const brand = page.locator(".auth__brand");
      await expect(brand).toContainText(m["app.name"]);
      const info = brand.getByRole("button", { name: m["common.whatIsThis"] });
      const hint = await hintOf(page, info);
      await expect(hint).toBeHidden();
      await info.tap();
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText(m["app.about"]);
      await expectOneLanguage(page, lang);
      await page.screenshot({ path: `e2e/screenshots/90-anmeldung-handy-${lang}.png` });
      // A tap elsewhere closes it; the form works as before.
      await page.getByRole("heading", { name: m["login.title"] }).tap();
      await expect(hint).toBeHidden();
    });
  }

  test("a tapped name in the overview explains itself in the text, the lines below move down", async ({
    page,
    foreign,
  }) => {
    void foreign;
    await login(page, uniqueEmail("sources-overview"));
    const id = await makeCharacter(page);
    await page.goto(`/c/${id}/overview`);
    const term = page.locator(".summary .term", { hasText: "Laternenträgerin" }).first();
    const word = term.locator(".term__word");
    const bubble = await hintOf(page, word);
    // The first line of text after the one with the name.
    const line = term.locator("xpath=ancestor::p[1]/following::*[self::p or self::h2][1]");
    // Distance from the name down to that line; the tap may scroll the page.
    const gap = async () => (await line.boundingBox())!.y - (await word.boundingBox())!.y;
    const before = await gap();
    await word.tap();
    const inline = term.locator(".term__inline");
    await expect(inline).toBeVisible();
    await expect(inline).toHaveText("Du bringst Licht ins Dunkel und hältst die Gruppe zusammen.");
    // The floating bubble stays away; the next row moved down instead of being covered.
    await expect(bubble).toBeHidden();
    await expectNothingCovered(inline);
    expect(await gap()).toBeGreaterThan(before);
    await expect(word).toHaveAttribute("aria-expanded", "true");
    await shot(page, "90-ueberblick-erklaerung-im-text");
    // A second tap closes it, a tap elsewhere too.
    await word.tap();
    await expect(inline).toBeHidden();
    await word.tap();
    await page.locator("main h1").tap();
    await expect(inline).toBeHidden();
  });

  test("what the character already has explains itself like the options", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("sources-held"));
    const id = await makeCharacter(page, false);
    await page.goto(`/c/${id}/step/talents`);
    const held = page.locator("[data-pool-held]");
    await expect(held).toContainText("Wetterkunde");
    await expect(held).toContainText("Fährkind");
    const word = held.locator(".term__word", { hasText: "Wetterkunde" });
    await word.tap();
    const inline = held.locator(".term__inline");
    await expect(inline).toHaveText("Du weisst, wann Regen, Sturm oder Nebel kommt.");
    await expectNothingCovered(inline);
    await shot(page, "90-das-hast-du-schon");
    // Where it came from explains itself too.
    await held.locator(".term__word", { hasText: "Fährkind" }).tap();
    await expect(held.locator(".term__inline")).toHaveText(
      "Du bist auf einer Fähre gross geworden, zwischen Wind und Händlern.",
    );
    await expectOneLanguage(page, "de");
  });

  test("a choice another choice brought says where it comes from", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("sources-from"));
    const id = await makeCharacter(page, false);
    // Grown up in the bell tower: its gift is a choice of its own.
    const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
      draft: { version: number };
    };
    const r = await page.request.put(`/api/drafts/${id}/answers/upbringing`, {
      data: { version: view.draft.version, answer: { pick: "upbringing.bell-tower" } },
    });
    expect(r.status()).toBe(200);

    // A pick a calling brought: the calling is named, and explains itself.
    await page.goto(`/c/${id}/step/path`);
    const from = page.locator("[data-choice-source]");
    await expect(from).toHaveText("Woher das kommt: Beruf Laternenträgerin.");
    await from.locator(".term__word").tap();
    await expect(from.locator(".term__inline")).toBeVisible();

    // The share-out says who decided which values it offers, and where to tap.
    await page.goto(`/c/${id}/step/bell-tower-gifts`);
    await expect(page.locator("[data-choice-source]")).toHaveText(
      "Kindheit Glockenturm erlaubt Kraft, Klugheit und Herz.",
    );
    await expect(page.locator(".array-assign__status")).toHaveText(
      "Wohin kommt die 2? Tippe auf einen Wert unten.",
    );
    await expectOneLanguage(page, "de");
    await shot(page, "90-attributsbonus-quelle");
  });
});
