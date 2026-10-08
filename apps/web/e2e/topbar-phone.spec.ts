/**
 * The top bar on a phone (AND-267): menu, the character's name and level,
 * the save status and the language share one row. Name and level stay on
 * one line, a long name ends in "…", the level always shows whole, nothing
 * is broken letter by letter; the save status is a mark, the language a
 * globe, both still there for keyboards and screen readers.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import pde from "../../../packages/demo-package/texts/de/core.json" with { type: "json" };
import pen from "../../../packages/demo-package/texts/en/core.json" with { type: "json" };
import { join } from "node:path";
import { animationsDone, chooseLanguage, expect, makeCharacter, SHOTS, signup, test } from "./helpers.ts";

/** Only the top bar, so the photo shows what this is about. */
const barShot = (page: Page, name: string) =>
  page.locator(".topbar").screenshot({ path: join(SHOTS, `${name}.png`) });

// As long as the demo package lets a name be (40 letters).
const LONG = "Ottilie Nebelwanderin aus dem Schilfmoor";

async function rename(page: Page, id: string, text: string) {
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const r = await page.request.put(`/api/drafts/${id}/answers/name`, {
    data: { version: view.draft.version, answer: { text } },
  });
  expect(r.status()).toBe(200);
}

/** Heights, widths and the cut of the parts of the top bar, as the browser laid them out. */
async function measure(page: Page) {
  return page.locator(".topbar").evaluate((bar) => {
    const box = (s: string) => bar.querySelector(s)!.getBoundingClientRect();
    const el = (s: string) => bar.querySelector(s) as HTMLElement;
    const line = parseFloat(getComputedStyle(el(".topbar__line")).lineHeight);
    return {
      line,
      lineHeight: box(".topbar__line").height,
      nameHeight: box(".topbar__name").height,
      nameCut: el(".topbar__name").scrollWidth > el(".topbar__name").clientWidth,
      levelCut: el(".topbar__level").scrollWidth > el(".topbar__level").clientWidth,
      nameWidth: box(".topbar__name").width,
      barRight: bar.getBoundingClientRect().right,
      languageRight: box(".language-menu").right,
      language: { width: box(".language-menu").width, height: box(".language-menu").height },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .include(".topbar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

for (const width of [412, 360]) {
  test.describe(`${width} px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const lang of ["de", "en"] as const) {
      test(`${lang}: a long name ends in "…", the level shows whole, one line`, async ({ page }) => {
        const m = lang === "de" ? de : en;
        const p = (lang === "de" ? pde : pen).entries as Record<string, string>;
        await signup(page, `Kopf ${lang} ${width}`);
        if (lang === "en") await chooseLanguage(page, "en");
        const id = await makeCharacter(page, false);
        await rename(page, id, LONG);
        await page.goto(`/c/${id}/step/scores`);
        const bar = page.getByRole("banner");
        await expect(bar.locator(".topbar__level")).toHaveText(`${p["level.name"]} 3`);
        await expect(bar.locator(".topbar__name")).toHaveText(LONG);
        await expect(bar.locator(".save-status--saved")).toBeVisible();

        const got = await measure(page);
        // One line: name and level as tall as one line of text, never a letter per line.
        expect(got.lineHeight).toBeLessThanOrEqual(got.line + 1);
        expect(got.nameHeight).toBeLessThanOrEqual(got.line + 1);
        expect(got.nameCut).toBe(true);
        expect(got.levelCut).toBe(false);
        // Room for a good part of the name: some ten letters before the "…".
        expect(got.nameWidth).toBeGreaterThanOrEqual(96);
        expect(got.overflow).toBeLessThanOrEqual(0);
        expect(got.languageRight).toBeLessThanOrEqual(got.barRight);
        expect(got.language.width).toBeGreaterThanOrEqual(44);
        expect(got.language.height).toBeGreaterThanOrEqual(44);

        // Still there for whoever does not see the marks.
        await expect(bar.getByText(m["save.saved"])).toBeAttached();
        await expect(bar.getByRole("combobox", { name: m["language.label"] })).toHaveValue(lang);
        await expect(bar.getByRole("button", { name: m["menu.open"] })).toBeVisible();
        await axe(page);
        await barShot(page, `topbar-${lang}-${width}-long`);

        // A short name shows whole, no "…".
        await rename(page, id, "Mira");
        await page.reload();
        await expect(bar.locator(".topbar__name")).toHaveText("Mira");
        expect((await measure(page)).nameCut).toBe(false);
        await barShot(page, `topbar-${lang}-${width}-short`);

        // The language switch still works from the globe.
        const other = lang === "de" ? "en" : "de";
        await bar.getByRole("combobox", { name: m["language.label"] }).selectOption(other);
        await expect(page.locator("html")).toHaveAttribute("lang", other);
      });
    }
  });
}

test.describe("at a desk", () => {
  test.use({
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 900 },
  });

  test("the save status and the language keep their words", async ({ page }) => {
    await signup(page, "Kopf Tisch");
    const id = await makeCharacter(page, false);
    await rename(page, id, LONG);
    await page.goto(`/c/${id}/step/scores`);
    const bar = page.getByRole("banner");
    await expect(bar.locator(".save-status")).toHaveText(de["save.saved"]);
    await expect(bar.locator(".save-status__mark")).toBeHidden();
    await expect(bar.locator(".language-menu .compact-select__shown")).toHaveText("Deutsch");
    await expect(bar.locator(".language-menu .compact-select__shown")).toBeVisible();
    expect((await measure(page)).nameCut).toBe(false);
    await barShot(page, "topbar-de-1280-long");
  });
});
