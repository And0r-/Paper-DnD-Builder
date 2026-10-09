/**
 * Large screens: the step list, the question and the explanation stand at
 * the same place on every step, the overview and the level included, and
 * stay there while the pointer moves over the options. A long word, in any
 * of the five languages, breaks inside its column instead of widening it
 * (AND-344).
 */
import { devices, type Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import {
  chooseLanguage,
  expect,
  makeLeveled,
  SCREEN,
  shot,
  signup,
  test,
  type ScreenLanguage,
} from "./helpers.ts";

test.use({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } });

/** Left edge and width of the three columns, rounded to whole pixels. */
async function columns(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const at = (s: string) => {
      const b = document.querySelector(s)?.getBoundingClientRect();
      return b ? `${Math.round(b.left)}+${Math.round(b.width)}` : "missing";
    };
    return { steps: at(".shell__sidebar"), question: at(".shell__main"), explain: at(".shell__aside") };
  });
}

/** Every element in the question or the explanation whose text runs out of it or scrolls sideways. */
async function spills(page: Page): Promise<string[]> {
  return page.locator(".shell__main, .shell__aside").evaluateAll((cols) =>
    cols.flatMap((col) =>
      [col, ...col.querySelectorAll("*")]
        .filter((el) => {
          // Inline boxes have no client width of their own (Firefox reports 0); their block does.
          // A box that scrolls sideways counts too: the column's own scroll box is one.
          return getComputedStyle(el).display !== "inline" && el.scrollWidth > el.clientWidth + 1;
        })
        .map((el) => `${el.className || el.tagName}: ${el.textContent?.slice(0, 60)}`),
    ),
  );
}

test("the columns stand still on every step and while hovering", async ({ page }) => {
  await signup(page, "columns");
  const id = await makeLeveled(page, 3, "calling.herbalist");
  await page.goto(`/c/${id}/overview`);
  const nav = page.getByRole("navigation", { name: m["flow.steps"] });
  await expect(nav).toBeVisible();
  await expect(page.locator(".shell__aside")).toBeAttached();
  const steps = [
    ...new Set(
      await nav.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname)),
    ),
  ];
  expect(steps).toContain(`/c/${id}/overview`);
  expect(steps).toContain(`/c/${id}/level`);
  expect(steps.length).toBeGreaterThan(5);

  const want = await columns(page);
  expect(want.explain).not.toBe("missing");
  for (const step of steps) {
    await page.goto(step);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await columns(page), step).toEqual(want);
  }

  // The pointer over each option of the long lists: nothing moves sideways.
  for (const step of ["knacks", "gear", "calling"]) {
    await page.goto(`/c/${id}/step/${step}`);
    const options = page.locator(".shell__main [data-option]");
    await expect(options.first()).toBeVisible();
    for (let i = 0; i < (await options.count()); i++) {
      await options.nth(i).locator(".option__name").hover();
      await expect(page.locator(".explain-panel__title")).toBeVisible();
      expect(await columns(page), `${step}, option ${i}`).toEqual(want);
    }
  }
});

/** One long word per language, longer than any line of the explanation. */
const LONG: Record<ScreenLanguage, string> = {
  de: "Verbalkomponentenzauberzeitaufwandsberechnungsgrundlagen",
  en: "incomprehensibilitiesoftheverbalcomponentsofeverycasting",
  fr: "anticonstitutionnellementincompréhensiblementdéraisonnable",
  it: "precipitevolissimevolmentesovramagnificentissimamente",
  es: "esternocleidomastoideoelectroencefalografistaanticonstitucional",
};

test("a long word breaks inside its column, in every language", async ({ page }) => {
  await signup(page, "longword");
  const id = await makeLeveled(page, 3, "calling.herbalist");
  await page.goto(`/c/${id}/step/knacks`);
  await expect(page.locator(".explain-panel")).toBeVisible();
  const want = await columns(page);
  for (const lang of Object.keys(SCREEN) as ScreenLanguage[]) {
    await chooseLanguage(page, lang);
    const option = page.locator(".shell__main [data-option]").first();
    await option.locator(".option__name").hover();
    const panel = page.locator(".explain-panel");
    await expect(panel.locator(".explain-panel__title")).toBeVisible();
    // The word in the explanation's title, in a value of its table, and in the option card itself.
    await page.evaluate((word) => {
      const put = (el: Element | null) => {
        if (el) el.textContent = `${el.textContent} ${word}`;
      };
      put(document.querySelector(".explain-panel__title"));
      put(document.querySelector(".explain-panel .stats dd, .explain-panel p:not(.explain-panel__title)"));
      put(document.querySelector(".shell__main [data-option] .option__name"));
      put(document.querySelector(".shell__main [data-option] .option__short"));
    }, LONG[lang]);
    expect(await spills(page), lang).toEqual([]);
    expect(await columns(page), lang).toEqual(want);
    if (lang === "de" || lang === "fr") await shot(page, `63-langes-wort-hilfe-${lang}`);
  }
});
