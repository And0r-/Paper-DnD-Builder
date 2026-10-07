/**
 * The online sheet's layout, measured (AND-207, findings of AND-184,
 * AND-185 and AND-186): at a desk of 1280 px the A4 pages of the PDF with a
 * footer each, the tools in one line, the boxes at the table in one row and
 * nothing past its section; on a phone of 390 px rest and close calls as
 * short rows, tables whose rows stack, and the menu's tools inside the
 * drawer in the sketch's order. A character of level 20, the longest sheet.
 */
import { devices, type Locator, type Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, makeCharacter, makeLeveled, test, uniqueEmail } from "./helpers.ts";

const DESIGNS = ["classic", "verbose"] as const;
const { defaultBrowserType: _desk, ...desk } = devices["Desktop Chrome"];

async function level20(page: Page): Promise<string> {
  await login(page, uniqueEmail("sheet-layout"));
  const id = await makeLeveled(page, 20);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const r = await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } });
  expect(r.status()).toBe(200);
  return id;
}

async function openSheet(page: Page, id: string, design: string): Promise<Locator> {
  const r = await page.request.patch("/api/account/settings", { data: { print: { design } } });
  expect(r.status()).toBe(200);
  await page.goto(`/c/${id}/bogen`);
  const sheet = page.locator("article[lang]");
  await sheet.locator("[data-section]").first().waitFor();
  return sheet;
}

const box = async (l: Locator) => (await l.boundingBox())!;

/** Elements whose content is wider than they are: words broken nowhere, run past their edge. */
async function overflowing(l: Locator): Promise<string[]> {
  return l.evaluateAll((els) =>
    els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent ?? ""),
  );
}

test.describe("at a desk", () => {
  test.use({ ...desk, viewport: { width: 1280, height: 900 } });

  test("pages as in the PDF, tools in one line, nothing past its section", async ({ page }) => {
    const id = await level20(page);
    for (const design of DESIGNS) {
      const sheet = await openSheet(page, id, design);
      const prefix = design === "classic" ? "csheet" : "vsheet";

      // 5: a footer per page, "page n of N", the same number as the pages.
      const footers = sheet.locator(`.${prefix}__footer`);
      await expect(footers.first()).toBeVisible();
      const n = await footers.count();
      expect(n, design).toBeGreaterThan(1);
      for (let p = 0; p < n; p++) await expect(footers.nth(p)).toContainText(`Seite ${p + 1} von ${n}`);

      // 10: the tools in one line.
      const bar = page.getByRole("group", { name: m["sheet.tools"] });
      const tops = await bar
        .locator(".sheet-tools__select, .btn")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
      expect(Math.max(...tops) - Math.min(...tops), design).toBeLessThan(4);

      // Nothing wider than the sheet; no table wider than its section (8).
      expect(await sheet.evaluate((e) => e.scrollWidth - e.clientWidth), design).toBeLessThanOrEqual(1);
      for (const s of await sheet.locator("[data-section]:has(table)").all()) {
        const [section, table] = [await box(s), await box(s.locator("table"))];
        expect(table.width, design).toBeLessThanOrEqual(section.width + 1);
      }

      // 6: a box's name is set smaller rather than broken or run out ("GLÜCKSMARKEN").
      expect(await overflowing(sheet.locator(`.${prefix}__box-label`)), design).toEqual([]);
    }
  });

  test("classic: the boxes at the table in one row, box rows first on their own page", async ({ page }) => {
    const sheet = await openSheet(page, await level20(page), "classic");
    // 6: the boxes to tick side by side, a row of three never broken into two and one.
    const ticking = sheet.locator(".csheet__cluster :is(.csheet__box--boxes, .csheet__box--circles)");
    expect(await ticking.count()).toBeGreaterThan(1);
    const tops = await ticking.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(new Set(tops.map(Math.round)).size).toBe(1);
    for (const b of await ticking.all()) {
      const marks = b.locator(".sheet-tick");
      if ((await marks.count()) > 4) continue;
      const rows = await marks.evaluateAll(
        (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size,
      );
      expect(rows).toBe(1);
    }
    // 5: on the page of its own the box rows come first.
    const apart = sheet.locator(".csheet__page--apart [data-section]");
    await expect(apart.first()).toHaveClass(/csheet__section--statBoxes/);
    // 8: "played by" is a place to write of at least 24 px.
    expect((await box(sheet.locator(".csheet__header .sheet-write"))).height).toBeGreaterThanOrEqual(24);
    // 8: in a check list the number stands on the line with its name.
    for (const row of (await sheet.locator(".csheet__check").all()).slice(0, 4)) {
      const [num, name] = [
        await box(row.locator(".csheet__check-total")),
        await box(row.locator(".csheet__check-name")),
      ];
      expect(Math.abs(num.y + num.height - (name.y + name.height))).toBeLessThan(3);
    }
  });

  test("verbose: help readable, the steps of a turn a line each", async ({ page }) => {
    const sheet = await openSheet(page, await level20(page), "verbose");
    // 9: no sentence that explains under 12 px.
    const sizes = await sheet
      .locator(".vsheet__hint, .vsheet__box-hint, .vsheet__group-hint")
      .evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    const help = sheet.locator(".vsheet__help p").first();
    expect(await help.evaluate((e) => (e as HTMLElement).innerText)).toMatch(/\n2\.\s/u);
  });

  test("the download dialog fits a window 900 px high", async ({ page }) => {
    await openSheet(page, await level20(page), "verbose");
    await page.getByRole("button", { name: m["sheet.download"] }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const d = await box(dialog);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.y + d.height).toBeLessThanOrEqual(900);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("rest and close calls are short rows, attacks stack, nothing cut", async ({ page }) => {
    const id = await level20(page);
    for (const design of DESIGNS) {
      const sheet = await openSheet(page, id, design);
      const prefix = design === "classic" ? "csheet" : "vsheet";
      // 11: the section with the most ticks stays short; name and ticks share a row.
      const rest = sheet.locator(`[data-section]:has(.${prefix}__box--boxes .sheet-tick:nth-child(10))`);
      expect((await box(rest)).height, design).toBeLessThan(500);
      for (const b of await rest.locator(`.${prefix}__box--boxes`).all()) {
        const [label, ticks] = [
          await box(b.locator(`.${prefix}__box-label`)),
          await box(b.locator(".sheet-ticks")),
        ];
        expect(label.y, design).toBeLessThan(ticks.y + ticks.height);
        expect(label.x + label.width, design).toBeLessThanOrEqual(ticks.x + 1);
      }
      // 13: a table's values all inside its section.
      const table = sheet.locator("[data-section]:has(table)").first();
      const right = (await box(table)).x + (await box(table)).width;
      for (const cell of await table.locator("tbody td:not([class*=row-tools])").all())
        expect((await box(cell)).x + (await box(cell)).width, design).toBeLessThanOrEqual(right + 1);
      expect(
        await table.locator("[class*=table-wrap]").evaluate((e) => e.scrollWidth - e.clientWidth),
        design,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("the menu: inside the drawer, in the sketch's order; stamina with − and +", async ({ page }) => {
    await login(page, uniqueEmail("sheet-menu"));
    // Level 3: one that can still go up, so "level up" is in the menu.
    const sheet = await openSheet(page, await makeCharacter(page), "classic");
    // 12: − and + count from the start value and are kept.
    const stepper = sheet.locator(".sheet-stepper").first();
    const start = Number(
      /\d+/u.exec((await sheet.locator(".csheet__start").first().textContent()) ?? "")![0],
    );
    await stepper.getByRole("button", { name: /eins weniger/u }).click();
    await expect(stepper.locator("input")).toHaveValue(String(start - 1));
    await expect(page.locator(".save-status--saved")).toBeVisible();
    await page.reload();
    await expect(page.locator(".sheet-stepper input").first()).toHaveValue(String(start - 1));

    await page.getByRole("button", { name: m["menu.open"] }).click();
    const menu = page.getByRole("dialog", { name: m["menu.title"] });
    const tools = menu.locator(".sheet-tools--menu");
    await expect(tools.getByRole("heading", { name: m["sheet.group"] })).toBeVisible();
    const edge = (await box(menu)).x + (await box(menu)).width;
    for (const el of await tools.locator("select, .btn").all())
      expect((await box(el)).x + (await box(el)).width).toBeLessThanOrEqual(edge + 1);
    const order = await tools.locator(".sheet-tools__actions .btn").allTextContents();
    expect(order.map((s) => s.trim())).toEqual([
      m["raise.button"],
      m["sheet.download"],
      m["sheet.clearChecks"],
      m["sheet.toBuilder"],
    ]);
  });
});
