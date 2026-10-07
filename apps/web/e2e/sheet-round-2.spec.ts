/**
 * The online sheet after the second round of findings (AND-213, from
 * AND-211 and AND-212), measured: at a desk the pages break where the PDF's
 * do, page 1 of "classic" stays A4 with the gear going on under its title
 * marked as continued, lines from the play state right under the entries;
 * the menu's words and buttons; on a phone the menu closes after clearing
 * all ticks.
 */
import { devices, type Locator, type Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, makeCharacter, makeLeveled, test, uniqueEmail } from "./helpers.ts";

const DESIGNS = ["classic", "verbose"] as const;
const { defaultBrowserType: _desk, ...desk } = devices["Desktop Chrome"];
const A4 = (297 / 25.4) * 96;

interface Section {
  kind: string;
  id: string;
  title: string;
  items?: string[];
  field?: string;
  rows?: { name: string; cells: string[] }[];
  columns?: string[];
}

async function finished(page: Page, level: number): Promise<string> {
  if (level === 3) return makeCharacter(page);
  const id = await makeLeveled(page, level);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  expect(
    (await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } })).status(),
  ).toBe(200);
  return id;
}

/** A kept copy with 20 long entries of gear and a long attack row of the player's own; two lines written on the gear's lines. */
async function longCopy(page: Page, id: string): Promise<{ copy: string; gear: Section }> {
  const made = (await (await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} })).json()) as {
    copy: { id: string; version: number };
    model: { sections: Section[] };
  };
  const model = made.model;
  const gear = model.sections.find((s) => s.kind === "list")!;
  gear.items = [
    ...gear.items!,
    ...Array.from({ length: 20 }, (_, i) => `Eigene lange Zeile ${i + 1} mit Seil und Kerzen`),
  ];
  const table = model.sections.find((s) => s.kind === "statTable")!;
  table.rows!.push({ name: "Sehr langer Name einer eigenen Waffe", cells: table.columns!.map(() => "1W4") });
  const put = await page.request.put(`/api/drafts/${id}/sheet-copies/${made.copy.id}`, {
    data: { version: made.copy.version, model },
  });
  expect(put.status()).toBe(200);
  await page.request.put(`/api/drafts/${id}/state`, {
    data: { version: 0, state: { [gear.field!]: "Kompass\nKreide" } },
  });
  return { copy: made.copy.id, gear };
}

async function openSheet(
  page: Page,
  id: string,
  design: string,
  copyId: string | null = null,
): Promise<Locator> {
  expect((await page.request.patch("/api/account/settings", { data: { print: { design } } })).status()).toBe(
    200,
  );
  await page.request.put(`/api/drafts/${id}/sheet-view`, { data: { copyId } });
  await page.goto(`/c/${id}/bogen`);
  const sheet = page.locator("article[lang]");
  await sheet.locator("[data-section]").first().waitFor();
  return sheet;
}

/** Pages of the PDF of the sheet alone. */
async function pdfPages(page: Page, id: string, design: string, version = "original"): Promise<number> {
  const res = await page.request.get(`/api/drafts/${id}/pdf?parts=sheet&design=${design}&version=${version}`);
  expect(res.status()).toBe(200);
  return (
    Buffer.from(await res.body())
      .toString("latin1")
      .match(/\/Type\s*\/Page\b(?!s)/gu) ?? []
  ).length;
}

const box = async (l: Locator) => (await l.boundingBox())!;

test.describe("at a desk", () => {
  test.use({ ...desk, viewport: { width: 1280, height: 900 } });

  for (const level of [3, 20]) {
    test(`as many pages as the PDF, original and copy, both designs (level ${level})`, async ({ page }) => {
      await login(page, uniqueEmail("sheet-pages"));
      const id = await finished(page, level);
      const { copy } = await longCopy(page, id);
      for (const design of DESIGNS) {
        const prefix = design === "classic" ? "csheet" : "vsheet";
        for (const version of [null, copy]) {
          const pages = await pdfPages(page, id, design, version ?? "original");
          const sheet = await openSheet(page, id, design, version);
          const what = `${design} ${version ? "copy" : "original"}`;
          await expect.poll(() => sheet.locator(`.${prefix}__footer`).count(), what).toBe(pages);
          await expect(sheet.locator(`.${prefix}__footer`).first()).toContainText(`Seite 1 von ${pages}`);
        }
      }
    });
  }

  test("verbose: the rolls on page 1 at level 20, as in the PDF", async ({ page }) => {
    await login(page, uniqueEmail("sheet-rolls"));
    const id = await finished(page, 20);
    const sheet = await openSheet(page, id, "verbose");
    await expect
      .poll(() => sheet.locator(".vsheet__footer").count())
      .toBe(await pdfPages(page, id, "verbose"));
    const paper = await box(sheet.locator(".vsheet__paper").first());
    const rolls = await box(sheet.locator("[data-section=rolls]"));
    expect(rolls.y + rolls.height).toBeLessThanOrEqual(paper.y + paper.height);
  });

  test("classic, a copy with many rows: page 1 stays A4, the gear goes on under its title, continued", async ({
    page,
  }) => {
    await login(page, uniqueEmail("sheet-gear"));
    const id = await finished(page, 20);
    const { copy, gear } = await longCopy(page, id);
    const sheet = await openSheet(page, id, "classic", copy);
    const pages = sheet.locator(".csheet__page");
    await expect.poll(async () => (await box(pages.first())).height).toBeLessThanOrEqual(A4 + 2);
    await expect(pages.nth(1).getByText(`${gear.title} · ${"Fortsetzung"}`, { exact: true })).toBeVisible();
    // Gear in one column on page 1.
    const lefts = await pages
      .first()
      .locator(".csheet__band li")
      .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(lefts).toBe(1);
    // A section that goes on in a page's second column says so there (the knacks on the slots' page).
    await expect(sheet.locator(".csheet__colbreak").first()).toBeVisible();
    // The harm on one line, the columns' names apart.
    const harm = sheet.locator("[data-section=attacks] tbody tr").first().locator("td.csheet__small").first();
    const lines = await harm.evaluate((e) => {
      const text = e.querySelector(".sheet-text")!.firstChild!;
      const r = document.createRange();
      r.selectNodeContents(text);
      return new Set([...r.getClientRects()].map((c) => Math.round(c.bottom))).size;
    });
    expect(lines).toBe(1);
    const heads = await sheet.locator("[data-section=attacks] thead th").all();
    for (let k = 1; k < heads.length; k++) {
      const [a, b] = [await box(heads[k - 1]!), await box(heads[k]!)];
      expect(b.x).toBeGreaterThan(a.x + 1);
    }
  });

  test("lines from the play state right under the entries, as high as them, both designs", async ({
    page,
  }) => {
    await login(page, uniqueEmail("sheet-lines"));
    const id = await finished(page, 3);
    const gear = (await longCopy(page, id)).gear;
    for (const design of DESIGNS) {
      const sheet = await openSheet(page, id, design);
      const list = sheet.locator(`[data-section="${gear.id}"]`).last();
      const last = await box(list.locator("li").last());
      const lines = list.locator("textarea");
      await expect(lines).toHaveValue("Kompass\nKreide");
      const area = await box(lines);
      expect(Math.abs(area.y - (last.y + last.height)), design).toBeLessThan(3);
      const pitch = await lines.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
      expect(Math.abs(pitch - last.height), design).toBeLessThan(2);
    }
  });

  test("the bar right under the top bar, its lists whole, the name once", async ({ page }) => {
    await login(page, uniqueEmail("sheet-bar"));
    const id = await finished(page, 3);
    for (const design of DESIGNS) {
      await openSheet(page, id, design);
      const top = await box(page.locator(".topbar"));
      const bar = await box(page.getByRole("group", { name: m["sheet.tools"] }));
      expect(bar.y - (top.y + top.height), design).toBeLessThan(40);
      // Style and language show their whole word.
      for (const label of [m["sheet.design"], m["sheet.language"]]) {
        const select = page.getByRole("group", { name: m["sheet.tools"] }).getByLabel(label, { exact: true });
        const [text, room] = await select.evaluate((e) => {
          const s = e as HTMLSelectElement;
          const c = document.createElement("canvas").getContext("2d")!;
          const st = getComputedStyle(s);
          c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
          return [
            c.measureText(s.selectedOptions[0]!.text).width,
            s.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight),
          ];
        });
        expect(text, `${design} ${label}`).toBeLessThanOrEqual(room + 1);
      }
      // The name in the top bar only once the sheet's own has scrolled away.
      await expect(page.locator(".sheet-topbar__name")).toBeHidden();
      await page.mouse.wheel(0, 1500);
      await expect(page.locator(".sheet-topbar__name")).toBeVisible();
    }
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the menu: one word for the style, the original named as in the download, buttons at one edge; clearing closes it", async ({
    page,
  }) => {
    await login(page, uniqueEmail("sheet-menu-2"));
    const id = await finished(page, 3);
    await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} });
    const sheet = await openSheet(page, id, "classic");
    // A tick to clear later.
    await sheet.locator(".sheet-tick").first().click();
    await expect(page.locator(".save-status--saved")).toBeVisible();
    await page.getByRole("button", { name: m["menu.open"] }).click();
    const menu = page.getByRole("dialog", { name: m["menu.title"] });
    const tools = menu.locator(".sheet-tools--menu");
    expect(m["sheet.design"]).not.toBe("Aussehen");
    await expect(tools.getByLabel(m["sheet.design"], { exact: true })).toBeVisible();
    // A copy's whole name shows in the list.
    const version = tools.getByLabel(m["sheet.version"], { exact: true });
    await version.selectOption({ index: 1 });
    const [text, room] = await version.evaluate((e) => {
      const s = e as HTMLSelectElement;
      const c = document.createElement("canvas").getContext("2d")!;
      const st = getComputedStyle(s);
      c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
      return [
        c.measureText(s.selectedOptions[0]!.text).width,
        s.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight),
      ];
    });
    expect(text).toBeLessThanOrEqual(room + 1);
    await sheet.locator("[data-section]").first().waitFor();
    // Every button's content (icon or word) starts at the same left edge.
    const starts = await tools
      .locator(".sheet-tools__actions .btn > :first-child")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(starts.length).toBeGreaterThan(2);
    expect(new Set(starts).size).toBe(1);
    // "Clear all ticks" closes the menu; "Undo" shows whole.
    await tools.getByRole("button", { name: m["sheet.clearChecks"] }).click();
    await expect(menu).toBeHidden();
    const undo = page.getByRole("button", { name: m["sheet.undoChecks"] });
    await expect(undo).toBeVisible();
    const u = await box(undo);
    expect(u.x + u.width).toBeLessThanOrEqual(390);
  });

  test("the download dialog names the original as the menu does", async ({ page }) => {
    await login(page, uniqueEmail("sheet-original"));
    const id = await finished(page, 3);
    await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} });
    await openSheet(page, id, "classic");
    await page.getByRole("button", { name: m["menu.open"] }).click();
    const menu = page.getByRole("dialog", { name: m["menu.title"] });
    const inMenu = await menu
      .getByLabel(m["sheet.version"], { exact: true })
      .locator("option")
      .first()
      .textContent();
    await menu.getByRole("button", { name: m["sheet.download"] }).click();
    const dialog = page.getByRole("dialog", { name: m["print.title"] });
    const inDialog = await dialog
      .getByLabel(m["print.version"], { exact: true })
      .locator("option")
      .first()
      .textContent();
    expect(inDialog).toBe(inMenu);
    await expect(dialog.getByText(m["print.design"], { exact: true })).toBeVisible();
  });
});
