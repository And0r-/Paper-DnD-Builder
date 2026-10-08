/**
 * The online sheet after the third round of findings (AND-216, from
 * AND-215), measured: in "classic" a short apart part under page 2 keeps
 * its rest in one column of a page's half width; page 1 stays A4 in both
 * languages, also on a reload; a copy's whole name in the bar at a desk; on
 * a phone no line of a copy's footer starts with its dot.
 */
import { devices, type Locator, type Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, makeCharacter, makeLeveled, signup, test } from "./helpers.ts";

const { defaultBrowserType: _desk, ...desk } = devices["Desktop Chrome"];
const A4 = (297 / 25.4) * 96;

async function finished(page: Page, level: number): Promise<string> {
  if (level === 3) return makeCharacter(page);
  const id = await makeLeveled(page, level);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  expect(
    (await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } })).status(),
  ).toBe(200);
  return id;
}

async function openSheet(page: Page, id: string, design: string, copyId: string | null = null) {
  expect((await page.request.patch("/api/account/settings", { data: { print: { design } } })).status()).toBe(
    200,
  );
  await page.request.put(`/api/drafts/${id}/sheet-view`, { data: { copyId } });
  await page.goto(`/c/${id}/bogen`);
  const sheet = page.locator("article[lang]");
  await sheet.locator("[data-section]").first().waitFor();
  return sheet;
}

const box = async (l: Locator) => (await l.boundingBox())!;

for (const width of [1280, 1440]) {
  test.describe(`at a desk, ${width} px`, () => {
    test.use({ ...desk, viewport: { width, height: 900 } });

    for (const lang of ["de", "en"] as const) {
      test(`classic, level 3 with a short apart part (${lang}): its rest under page 2 in one column of half the page`, async ({
        page,
      }) => {
        await signup(page, "sheet-apart", lang);
        const id = await finished(page, 3);
        const sheet = await openSheet(page, id, "classic");
        const pages = sheet.locator(".csheet__page");
        await expect.poll(() => pages.count()).toBe(2);
        const apart = pages.nth(1).locator(".csheet__apart");
        await expect(apart).toHaveClass(/csheet__apart--one/u);
        // Not only the page count: the rows are as wide as a column of the page (about half), not a quarter.
        const content = await box(pages.nth(1).locator(".csheet__more"));
        const rows = apart.locator("[data-row]");
        expect(await rows.count()).toBeGreaterThan(0);
        for (const r of await rows.all()) {
          const w = (await box(r)).width;
          expect(w).toBeGreaterThan(content.width * 0.45);
          expect(w).toBeLessThan(content.width * 0.55);
        }
        // A row's name beside its text, not over it.
        const feature = apart.locator(".csheet__feature").first();
        const [name, text] = [
          await box(feature.locator(".csheet__feature-title")),
          await box(feature.locator(".csheet__feature-text")),
        ];
        expect(name.y + name.height <= text.y + 1 || name.x + name.width <= text.x + 1).toBe(true);
      });

      test(`classic, level 20 (${lang}): page 1 stays A4, also after a reload`, async ({ page }) => {
        await signup(page, "sheet-a4", lang);
        const id = await finished(page, 20);
        for (let run = 0; run < 3; run++) {
          const sheet = await openSheet(page, id, "classic");
          const first = sheet.locator(".csheet__page").first();
          // Settled, and settled at A4: the same height a moment later.
          await expect
            .poll(async () => (await box(first)).height, `run ${run}`)
            .toBeLessThanOrEqual(A4 + 0.5);
          await page.waitForTimeout(500);
          expect((await box(first)).height, `run ${run}`).toBeLessThanOrEqual(A4 + 0.5);
        }
      });
    }

    test("version and style in the top bar: a fixed width, a long name cut with …, whole when opened", async ({
      page,
    }) => {
      await signup(page, "sheet-bar-name");
      const id = await finished(page, 3);
      const made = (await (
        await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} })
      ).json()) as {
        copy: { id: string };
      };
      await openSheet(page, id, "classic", made.copy.id);
      const banner = page.getByRole("banner");
      const version = banner.getByRole("combobox", { name: m["sheet.version"], exact: true });
      const style = banner.getByRole("combobox", { name: m["sheet.design"], exact: true });
      await expect(version).toBeVisible();
      await expect(style).toHaveValue("classic");
      // No title shown: an icon, the name for screen readers.
      await expect(banner.getByText(m["sheet.version"], { exact: true })).toHaveClass("visually-hidden");
      // The copy's name is longer than the list: cut at its end, the list no wider.
      const shown = page.locator(".compact-select--version .compact-select__shown");
      const cut = () =>
        shown.evaluate((e) => [e.scrollWidth > e.clientWidth, getComputedStyle(e).textOverflow] as const);
      expect(await cut()).toEqual([true, "ellipsis"]);
      const long = await box(version);
      const style1 = await box(style);
      // Opened, every entry reads whole: the options carry the whole name.
      const whole = (await version.locator("option:checked").textContent())!;
      expect(whole).toMatch(/\d{1,2}:\d{2}/u);
      expect(await shown.textContent()).toBe(whole);
      // The original: the bar does not move.
      await version.selectOption("original");
      await expect(shown).toHaveText(m["sheet.original"]);
      expect(await box(version)).toEqual(long);
      expect(await box(style)).toEqual(style1);
      // Keyboard: Tab reaches the lists, arrows change them.
      await version.focus();
      await page.keyboard.press("ArrowDown");
      await expect(version).toHaveValue(made.copy.id);
      expect(await box(version)).toEqual(long);
      await page.keyboard.press("Tab");
      await expect(style).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(banner.getByRole("combobox", { name: m["language.label"] })).toBeFocused();
      // Only the sheet has them: elsewhere the top bar has the language alone.
      for (const url of ["/characters", `/c/${id}/overview`, "/settings", "/campaigns"]) {
        await page.goto(url);
        await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expect(banner.getByRole("combobox")).toHaveCount(1);
      }
    });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a copy's footer wraps with its dots at the end of a line, never at the start", async ({ page }) => {
    await signup(page, "sheet-footer-dot");
    const id = await finished(page, 3);
    const made = (await (await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} })).json()) as {
      copy: { id: string };
    };
    for (const design of ["classic", "verbose"]) {
      const sheet = await openSheet(page, id, design, made.copy.id);
      const line = sheet.locator("footer:visible > span").first();
      await expect(line).toContainText("·");
      const starts = await line.evaluate((el) => {
        // The top of every character; a dot whose character before it is on a line above starts a line.
        const tops: { ch: string; top: number }[] = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const text = n.textContent ?? "";
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const rect = r.getClientRects()[0];
            if (rect && text[i]!.trim() !== "") tops.push({ ch: text[i]!, top: Math.round(rect.top) });
          }
        }
        return tops.filter((t, k) => t.ch === "·" && k > 0 && tops[k - 1]!.top < t.top).length;
      });
      expect(starts, design).toBe(0);
    }
  });
});
