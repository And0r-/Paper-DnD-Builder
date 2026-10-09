/**
 * The online sheet in "classic" stands still once shown (AND-332): no row
 * at the foot of page 1 goes back and forth to page 2, neither when opened
 * nor when scrolled; the pages break where the PDF's do from the first
 * frame shown, also when opened again in the tab, and once by the design's
 * own rule when the PDF's places do not come.
 */
import { devices, type Page } from "@playwright/test";
import { expect, makeLeveled, signup, test } from "./helpers.ts";

const { defaultBrowserType: _desk, ...desk } = devices["Desktop Chrome"];

interface Section {
  kind: string;
  items?: string[];
}

/** A finished character of level 5 shown as a kept copy with gear of many lengths, so page 1 is full. */
async function longSheet(page: Page): Promise<string> {
  await signup(page, "sheet-steady");
  const id = await makeLeveled(page, 5);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  expect(
    (await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } })).status(),
  ).toBe(200);
  const made = (await (await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} })).json()) as {
    copy: { id: string; version: number };
    model: { sections: Section[] };
  };
  const gear = made.model.sections.find((s) => s.kind === "list")!;
  const words = "Seil Kerzen Kreide Kompass Laterne Decke Feuerstein Wasserschlauch".split(" ");
  gear.items = [
    ...gear.items!,
    ...Array.from(
      { length: 22 },
      (_, i) => `Eigene Zeile ${i + 1} ${words.slice(0, 1 + (i % words.length)).join(" ")}`,
    ),
  ];
  const put = await page.request.put(`/api/drafts/${id}/sheet-copies/${made.copy.id}`, {
    data: { version: made.copy.version, model: made.model },
  });
  expect(put.status()).toBe(200);
  await page.request.put(`/api/drafts/${id}/sheet-view`, { data: { copyId: made.copy.id } });
  expect(
    (await page.request.patch("/api/account/settings", { data: { print: { design: "classic" } } })).status(),
  ).toBe(200);
  return id;
}

/**
 * Notes every frame what the pages hold (the sections and their rows per
 * page) and, at a desk, where page 2's first section starts, from the first
 * frame the sheet shows; `window.__pages` keeps each change. (On a phone the
 * cards follow one another, and a card above may still settle by a pixel or
 * two while the fonts come.)
 */
async function watchPages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __pages: string[] }).__pages = seen;
    const tick = () => {
      const sheet = document.querySelector(".csheet");
      if (sheet) {
        const pages = [...sheet.querySelectorAll(":scope > .csheet__page")];
        const top = sheet.getBoundingClientRect().top;
        const next = pages[1]?.querySelector("[data-index]");
        const state = [
          ...pages.map((p) =>
            [...p.querySelectorAll("[data-index]")]
              .map((s) => `${(s as HTMLElement).dataset["index"]}:${s.querySelectorAll("[data-row]").length}`)
              .join(","),
          ),
          next && matchMedia("(min-width: 900px)").matches
            ? Math.round(next.getBoundingClientRect().top - top)
            : "-",
        ].join(" | ");
        if (seen.at(-1) !== state) seen.push(state);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const pagesSeen = (page: Page) => page.evaluate(() => (window as unknown as { __pages: string[] }).__pages);

/** Opened: shown, a second, then scrolled to the foot of page 1 and on; the pages as first shown all along. */
async function expectSteady(page: Page, id: string): Promise<string[]> {
  await page.goto(`/c/${id}/bogen`);
  await page.locator(".csheet [data-section]").first().waitFor();
  await page.waitForTimeout(1000);
  // To the foot of page 1 (on a phone, the foot of its cards), then on with the wheel.
  await page.evaluate(() => {
    const first = document.querySelector(".csheet__page")!.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + first.bottom - window.innerHeight / 2);
  });
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  const seen = await pagesSeen(page);
  expect(seen, seen.join("\n")).toHaveLength(1);
  return seen;
}

for (const [where, use] of [
  ["at a desk", { ...desk, viewport: { width: 1280, height: 900 } }],
  ["on a phone", {}],
] as const) {
  test.describe(where, () => {
    test.use(use);

    test("classic stands still when opened, scrolled and opened again", async ({ page }) => {
      await watchPages(page);
      const id = await longSheet(page);
      const first = await expectSteady(page, id);
      // Opened again in the tab: the places known, the same pages at once.
      expect(
        await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith("sheet-places:"))),
      ).toBe(true);
      expect(await expectSteady(page, id)).toEqual(first);
    });

    test("no places from the server: the design's own breaks, once", async ({ page }) => {
      await watchPages(page);
      const id = await longSheet(page);
      await page.route("**/sheet-places", (r) => r.fulfill({ status: 500, body: "{}" }));
      await expectSteady(page, id);
    });

    test("places that do not come: the skeleton, then the design's own breaks, once", async ({ page }) => {
      await watchPages(page);
      const id = await longSheet(page);
      await page.route("**/sheet-places", () => {
        // No answer at all.
      });
      await expectSteady(page, id);
    });
  });
}
