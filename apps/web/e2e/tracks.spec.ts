/**
 * Levels in more than one calling (concept AND-262, section 6; AND-251), on
 * the demo package, in German and English, on a phone and at a desk: build
 * a level-5 character with two callings, raise one into a new calling, and
 * take a calling away and back (its answers come back with it).
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { join } from "node:path";
import {
  animationsDone,
  answerRecommended,
  expect,
  expectOneLanguage,
  SCREEN,
  SHOTS,
  signup,
  test,
} from "./helpers.ts";

const SIZES = {
  phone: { viewport: { width: 390, height: 844 } },
  desktop: { isMobile: false, hasTouch: false, deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } },
} as const;

/** The demo's words in each language. */
const DEMO = {
  de: { level: "Stufe", lantern: "Laternenträgerin", herbalist: "Kräuterkundige", runner: "Flussläufer" },
  en: { level: "Level", lantern: "Lantern Bearer", herbalist: "Herbalist", runner: "River Runner" },
} as const;

const LANTERN = "calling.lantern-bearer";
const HERBALIST = "calling.herbalist";
const HERB_CRAFT = "herb-craft@calling.herbalist";

/** A screen text with its placeholders filled. */
function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** A lantern bearer of `level` whose scores allow adding the herbalist, not the river runner. */
async function lanternBearer(page: Page, level: number): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { draft: { id: string } }).draft.id;
  await answerRecommended(page, id, {
    level,
    calling: LANTERN,
    answers: [
      ["folk", { pick: "folk.moorfolk" }],
      ["scores", { method: 0, assign: { mightBase: 8, graceBase: 6, witBase: 10, heartBase: 12 } }],
    ],
  });
  return id;
}

interface View {
  draft: { version: number; tracks: string[]; answers: Record<string, unknown> };
  evaluation: { complete: boolean; steps: { id: string; status: string }[] };
}

async function view(page: Page, id: string): Promise<View> {
  return (await (await page.request.get(`/api/drafts/${id}`)).json()) as View;
}

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

/** Answers every open step with "choose for me", starting from the overview's link to the first one. */
async function answerOpen(page: Page, id: string, lang: "de" | "en") {
  const m = SCREEN[lang];
  for (let guard = 0; guard < 20; guard++) {
    await page.goto(`/c/${id}/overview`);
    await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
    const open = page.locator(".callout").getByRole("link");
    if ((await open.count()) === 0) return;
    await open.first().click();
    await page.waitForURL(/\/step\//);
    const choose = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
    await choose.click();
    await expect(page.locator(".shortcuts__done")).toBeVisible();
    const here = page.url();
    await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    await expect(page).not.toHaveURL(here);
  }
  throw new Error("steps stay open");
}

for (const device of ["phone", "desktop"] as const) {
  for (const lang of ["de", "en"] as const) {
    test.describe(`${device}, ${lang}`, () => {
      test.use(SIZES[device]);
      const m = SCREEN[lang];
      const d = DEMO[lang];
      const levelWord = lang === "de" ? d.level : d.level.toLowerCase();
      const shot = (page: Page, name: string) =>
        page.screenshot({ path: join(SHOTS, `251-${name}-${lang}-${device}.png`), fullPage: true });

      test("builds a level-5 character with two callings, takes one away and back", async ({
        page,
        foreign,
      }) => {
        void foreign;
        await signup(page, `tracks-${lang}-${device}`, lang);
        const id = await lanternBearer(page, 5);

        // The step for the levels: one sentence, nothing to do.
        await page.goto(`/c/${id}/tracks`);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: fill(m["tracks.step.question"], { levelName: levelWord }),
          }),
        ).toBeVisible();
        await expect(page.locator(".tracks-all__line")).toHaveText(
          fill(m["tracks.step.all"], { levelName: d.level, level: 5, thing: d.lantern }),
        );
        await expectOneLanguage(page, lang);
        await shot(page, "step-closed");

        // Split: levels 4 and 5 to the herbalist; the river runner is refused, with the package's reason.
        await page.getByRole("button", { name: m["tracks.step.split"] }).click();
        const levels = page.locator(".tracks-levels");
        await levels.getByLabel(`${d.level} 4`, { exact: true }).selectOption(HERBALIST);
        await levels.getByLabel(`${d.level} 5`, { exact: true }).selectOption(HERBALIST);
        await expect(page.locator(".tracks-result")).toHaveText(
          fill(m["tracks.step.result"], { line: `${d.lantern} 3 / ${d.herbalist} 2` }),
        );
        await expect(page.locator(".tracks-refused")).toContainText(d.runner);
        await expectOneLanguage(page, lang);
        await axe(page);
        await shot(page, "step-split");

        // A step of the herbalist names it, with the level in it.
        await expect
          .poll(async () => (await view(page, id)).draft.tracks)
          .toEqual([LANTERN, LANTERN, HERBALIST, HERBALIST]);
        await page.goto(`/c/${id}/step/${encodeURIComponent(HERB_CRAFT)}`);
        await expect(page.locator(".progress__text")).toContainText(
          fill(m["flow.trackLevel"], { thing: d.herbalist, levelName: d.level, level: 1 }),
        );
        await expectOneLanguage(page, lang);
        await shot(page, "added-step");

        await answerOpen(page, id, lang);
        const herbCraft = (await view(page, id)).draft.answers[HERB_CRAFT];
        expect(herbCraft).toBeDefined();

        // The overview: the head line, and what grows by calling.
        await page.goto(`/c/${id}/overview`);
        await expect(page.locator(".overview-line")).toHaveText(
          `${d.lantern} 3 / ${d.herbalist} 2 · ${d.level} 5`,
        );
        await expect(page.locator(".growth")).toContainText(m["tracks.growth.whole"]);
        await expect(
          page.locator(".growth__track-title", {
            hasText: fill(m["tracks.growth.track"], { thing: d.herbalist, levelName: d.level, level: 2 }),
          }),
        ).toBeVisible();
        await expectOneLanguage(page, lang);
        await axe(page);
        await shot(page, "overview");

        // Away: all levels back to the lantern bearer. The herbalist's answers stay in the draft.
        await page.goto(`/c/${id}/tracks`);
        await page.getByRole("button", { name: fill(m["tracks.step.reset"], { thing: d.lantern }) }).click();
        await expect(page.locator(".tracks-result")).toHaveText(
          fill(m["tracks.step.result"], { line: `${d.lantern}, ${d.level} 5` }),
        );
        await expect.poll(async () => (await view(page, id)).draft.tracks).toEqual([]);
        expect((await view(page, id)).draft.answers[HERB_CRAFT]).toEqual(herbCraft);

        // And back: the old answers count again, nothing is open.
        await levels.getByLabel(`${d.level} 4`, { exact: true }).selectOption(HERBALIST);
        await levels.getByLabel(`${d.level} 5`, { exact: true }).selectOption(HERBALIST);
        await expect.poll(async () => (await view(page, id)).evaluation.complete).toBe(true);
        expect((await view(page, id)).evaluation.steps.find((s) => s.id === HERB_CRAFT)?.status).toBe("done");

        // The list of characters says it the same way.
        await page.goto("/characters");
        await expect(page.locator(".character__line").first()).toHaveText(
          `${d.lantern} 3 / ${d.herbalist} 2 · ${d.level} 5`,
        );
        await expectOneLanguage(page, lang);
      });

      test("raises into a new calling, takes it away and back", async ({ page, foreign }) => {
        void foreign;
        await signup(page, `raise-tracks-${lang}-${device}`, lang);
        const id = await lanternBearer(page, 3);
        const finished = await page.request.post(`/api/drafts/${id}/finish`, {
          data: { version: (await view(page, id)).draft.version },
        });
        expect(finished.status()).toBe(200);

        const raiseTo = async (pick: string) => {
          await page.goto(`/c/${id}/raise`);
          await page
            .getByRole("button", { name: fill(m["raise.go"], { levelName: d.level, level: 4 }) })
            .click();
          await expect(page.getByRole("heading", { level: 1 })).toContainText(`${d.level} 4`);
          await page.getByRole("radio", { name: pick, exact: true }).check();
          await page
            .getByRole("button", { name: fill(m["raise.go"], { levelName: d.level, level: 4 }) })
            .click();
          await page.waitForURL(/\/(step\/[^/?]+|overview)$/);
        };

        // The question: carry on (recommended and chosen), or add one; the river runner is greyed with its reason.
        await page.goto(`/c/${id}/raise`);
        await page
          .getByRole("button", { name: fill(m["raise.go"], { levelName: d.level, level: 4 }) })
          .click();
        const carryOn = page.getByRole("radio", {
          name: fill(m["tracks.raise.continue"], { thing: d.lantern }),
        });
        await expect(carryOn).toBeChecked();
        const runner = page.locator(`.option[data-track="calling.river-runner"]`);
        await expect(runner.locator(".option__blocked")).toContainText(
          lang === "de" ? "Braucht Geschick 10 oder mehr" : "Needs Grace 10 or more",
        );
        await runner.locator("input").click({ force: true });
        await expect(carryOn).toBeChecked();
        await expectOneLanguage(page, lang);
        await axe(page);
        await shot(page, "raise-question");

        // Into the herbalist: its first step says so.
        await page.getByRole("radio", { name: d.herbalist, exact: true }).check();
        await expect(
          page.locator(".callout").filter({ hasText: `${d.lantern} 3 / ${d.herbalist} 1` }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: fill(m["raise.go"], { levelName: d.level, level: 4 }) })
          .click();
        await page.waitForURL(/\/(step\/[^/?]+|overview)$/);
        await expect
          .poll(async () => (await view(page, id)).draft.tracks)
          .toEqual([LANTERN, LANTERN, HERBALIST]);
        await page.goto(`/c/${id}/step/${encodeURIComponent(HERB_CRAFT)}`);
        await expect(page.locator(".progress__text")).toContainText(
          fill(m["flow.trackLevel"], { thing: d.herbalist, levelName: d.level, level: 1 }),
        );
        await page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] }).click();
        await expect(page.locator(".shortcuts__done")).toBeVisible();
        await page.getByRole("button", { name: m["common.next"], exact: true }).click();
        await expectOneLanguage(page, lang);
        await shot(page, "raise-added-step");
        await expect.poll(async () => (await view(page, id)).draft.answers[HERB_CRAFT]).toBeDefined();
        const herbCraft = (await view(page, id)).draft.answers[HERB_CRAFT];

        // Away: the level goes to the lantern bearer; the herbalist's answer stays in the draft.
        await raiseTo(fill(m["tracks.raise.continue"], { thing: d.lantern }));
        await expect.poll(async () => (await view(page, id)).draft.tracks).toEqual([]);
        expect((await view(page, id)).draft.answers[HERB_CRAFT]).toEqual(herbCraft);
        expect((await view(page, id)).evaluation.steps.map((s) => s.id)).not.toContain(HERB_CRAFT);

        // Back: the old answer counts again.
        await raiseTo(d.herbalist);
        await expect
          .poll(async () => (await view(page, id)).draft.tracks)
          .toEqual([LANTERN, LANTERN, HERBALIST]);
        expect((await view(page, id)).evaluation.steps.find((s) => s.id === HERB_CRAFT)?.status).toBe("done");

        // Finish: the end, then the list, with both callings.
        await answerOpen(page, id, lang);
        await page.goto(`/c/${id}/overview`);
        await page.getByRole("button", { name: m["overview.finish"] }).click();
        await expect(page).toHaveURL(new RegExp(`/c/${id}/done`));
        await page.goto("/characters");
        await expect(page.locator(".character__line").first()).toHaveText(
          `${d.lantern} 3 / ${d.herbalist} 1 · ${d.level} 4`,
        );
      });
    });
  }
}
