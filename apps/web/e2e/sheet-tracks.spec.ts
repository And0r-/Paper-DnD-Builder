/**
 * The sheet of a character with two callings (AND-305), on a phone and at a
 * desk, in German and English, in both designs: the head says which calling
 * came first (the head line orders them by levels), and the knacks come in
 * a block per calling, so the player sees which calling a knack is from.
 * The character is the demo's example `herbalist-river-runner`: herbalist
 * at level 1, then four levels of river runner.
 */
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { animationsDone, expect, expectOneLanguage, SCREEN, SHOTS, signup, test } from "./helpers.ts";

const EXAMPLE = fileURLToPath(
  new URL("../../../packages/demo-package/examples/herbalist-river-runner.json", import.meta.url),
);

const SIZES = {
  phone: { viewport: { width: 390, height: 844 } },
  desktop: { isMobile: false, hasTouch: false, deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } },
} as const;

/** The demo's words and the sheet's own in each language. */
const WORDS = {
  de: {
    head: "Flussläufer 4 / Kräuterkundige 1 · Stufe 5",
    startedAs: "Angefangen als",
    first: "Kräuterkundige",
    runner: "Flussläufer",
    rank: "Rang",
  },
  en: {
    head: "River Runner 4 / Herbalist 1 · Level 5",
    startedAs: "Started as",
    first: "Herbalist",
    runner: "River Runner",
    rank: "Rank",
  },
} as const;

/** The example character, answered through the API in the order of its file, and finished. */
async function example(page: Page): Promise<string> {
  const doc = JSON.parse(await readFile(EXAMPLE, "utf8")) as {
    level: number;
    tracks: string[];
    answers: Record<string, unknown>;
  };
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  const send = async (what: string, r: ReturnType<typeof req.put>) => {
    const res = await r;
    expect(res.status(), what).toBe(200);
    view = await res.json();
  };
  await send(
    "level",
    req.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: doc.level } }),
  );
  await send(
    "calling",
    req.put(`/api/drafts/${id}/answers/calling`, {
      data: { version: view.draft.version, answer: doc.answers["calling"] },
    }),
  );
  await send(
    "tracks",
    req.put(`/api/drafts/${id}/tracks`, { data: { version: view.draft.version, tracks: doc.tracks } }),
  );
  for (const [choice, answer] of Object.entries(doc.answers)) {
    if (choice === "calling") continue;
    await send(
      choice,
      req.put(`/api/drafts/${id}/answers/${encodeURIComponent(choice)}`, {
        data: { version: view.draft.version, answer },
      }),
    );
  }
  const done = await req.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } });
  expect(done.status()).toBe(200);
  return id;
}

for (const device of ["phone", "desktop"] as const) {
  for (const lang of ["de", "en"] as const) {
    test.describe(`${device}, ${lang}`, () => {
      test.use(SIZES[device]);
      const w = WORDS[lang];
      const m = SCREEN[lang];
      /** The sheet's tools: in the bar at a desk, in the menu on a phone. */
      const tools = async (page: Page) => {
        if (device === "desktop") return page.locator(".topbar, .sheet-tools--bar");
        const button = page.getByRole("button", { name: m["menu.open"] });
        const menu = page.getByRole("dialog", { name: m["menu.title"] });
        await expect(async () => {
          if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
          await expect(menu.getByRole("heading", { name: m["sheet.group"] })).toBeVisible({ timeout: 1000 });
        }).toPass();
        return menu;
      };

      test("the sheet names the first calling and lists knacks by calling", async ({ page, foreign }) => {
        void foreign;
        await signup(page, `sheet-tracks-${lang}-${device}`, lang);
        const id = await example(page);
        await page.goto(`/c/${id}/bogen`);

        // The head: the callings by levels, and which one came first, right after the summary.
        const sheet = page.locator(".vsheet");
        await expect(sheet.locator(".vsheet__summary")).toHaveText(w.head);
        const first = sheet.locator(".vsheet__fields > div").first();
        await expect(first.locator("dt")).toHaveText(w.startedAs);
        await expect(first.locator("dd")).toHaveText(w.first);

        // The knacks: the river runner's block (more levels) first, ranks inside, then the herbalist's.
        await expect(sheet.locator("[data-section=knacks] .vsheet__group")).toHaveText([
          new RegExp(`^${w.runner} · ${w.rank} 1`),
          new RegExp(`^${w.runner} · ${w.rank} 2`),
          new RegExp(`^${w.first} · ${w.rank} 1`),
        ]);
        await expectOneLanguage(page, lang);
        await animationsDone(page);
        await page.screenshot({ path: join(SHOTS, `305-sheet-${lang}-${device}.png`), fullPage: true });
        // Nothing wider than the screen on a phone.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          SIZES[device].viewport.width,
        );

        // The classic look says the same.
        await (await tools(page)).getByLabel(m["sheet.design"]).selectOption("classic");
        if (device === "phone")
          await page.getByRole("button", { name: m["common.close"], exact: true }).click();
        const classic = page.locator(".csheet");
        await expect(classic.getByText(w.startedAs, { exact: true })).toBeVisible();
        await expect(classic.locator("[data-section=knacks] .csheet__group")).toHaveText([
          new RegExp(`^${w.runner} · ${w.rank} 1`),
          new RegExp(`^${w.runner} · ${w.rank} 2`),
          new RegExp(`^${w.first} · ${w.rank} 1`),
        ]);
        await expectOneLanguage(page, lang);
        await animationsDone(page);
        await page.screenshot({
          path: join(SHOTS, `305-sheet-classic-${lang}-${device}.png`),
          fullPage: true,
        });
      });
    });
  }
}
