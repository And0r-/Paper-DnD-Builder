/**
 * Level up a finished character (plan 4.2, done criteria 4 and 5): the
 * button on the character, the choice of level above the current one, then
 * only the questions the new levels bring, counted from 1. Nothing chosen
 * before is asked again. The end names the new level and what came with it.
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, type Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  answerRecommended,
  expect,
  expectOneLanguage,
  login,
  makeLeveled,
  shot,
  test,
  uniqueEmail,
} from "./helpers.ts";

const m = de;

/** A finished character of `level` made through the API with "choose for me" answers. */
async function finished(page: Page, level: number): Promise<string> {
  const id = await makeLeveled(page, level);
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { version: number };
  };
  const r = await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } });
  expect(r.status()).toBe(200);
  return id;
}

async function stepIds(page: Page, id: string): Promise<string[]> {
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    evaluation: { steps: { id: string }[] };
  };
  return view.evaluation.steps.map((s) => s.id);
}

const stepOf = (url: string) => {
  const m = /\/step\/([^/?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]!) : undefined;
};

/**
 * Goes through the flow with "choose for me" and Next until the overview,
 * checking the count on every screen. Returns the steps it went through.
 */
async function walk(page: Page, total: number): Promise<string[]> {
  const visited: string[] = [];
  for (let guard = 0; guard < 60; guard++) {
    await page.waitForURL(/\/(step\/[^/?]+|overview)$/);
    const url = page.url();
    if (url.endsWith("/overview")) break;
    const key = stepOf(url)!;
    visited.push(key);
    await expect(page.locator(".progress__text")).toContainText(`von ${total}`);
    const choose = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
    const info = page.getByRole("button", { name: m["info.continue"] });
    if (await choose.isVisible()) {
      await choose.click();
      await expect(page.locator(".shortcuts__done")).toBeVisible();
      await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    } else if (await info.isVisible()) {
      await info.click();
    } else {
      await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    }
    await expect(page).not.toHaveURL(url);
  }
  await expect(page.locator(".progress__text")).toContainText(`Schritt ${total} von ${total}`);
  return visited;
}

async function finishOnOverview(page: Page, id: string, from: number) {
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);
  await page.getByRole("button", { name: m["overview.finish"] }).click();
  await expect(page).toHaveURL(`/c/${id}/done?from=${from}`);
}

test("a level-1 character goes up to 2, 3 and 5, asked only what is new each time", async ({
  page,
  foreign,
}) => {
  void foreign;
  await login(page, uniqueEmail("level-up"));
  const id = await finished(page, 1);
  const level1 = await stepIds(page, id);

  // The button on the character list.
  await page.goto("/characters");
  await page.getByRole("link", { name: "Mira aufstufen" }).click();
  await expect(page).toHaveURL(`/c/${id}/raise`);
  await expect(page.getByRole("heading", { level: 1, name: "Auf welche Stufe steigt Mira?" })).toBeVisible();
  await expect(page.getByText("Im Moment: Stufe 1.")).toBeVisible();
  // One level higher is chosen and recommended; only levels above the current one.
  await expect(page.getByRole("radio", { name: "Stufe 2" })).toBeChecked();
  await expect(page.locator(".level-card").first()).toContainText(m["common.recommended"]);
  await expect(
    page.getByText("Alles, was du schon gewählt hast, bleibt. Du beantwortest nur, was Stufe 2 neu bringt."),
  ).toBeVisible();
  await expectOneLanguage(page, "de");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await shot(page, "90-aufstufen-wahl");

  // 1 → 2: the talent list and the knacks ask one more each; nothing else.
  await page.getByRole("button", { name: "Weiter zu Stufe 2" }).click();
  await expect(page).toHaveURL(`/c/${id}/step/talents`);
  await expect(page.locator(".progress__text")).toContainText("Schritt 1 von 3");
  await expect(page.locator(".progress__text")).toContainText("Stufe 2");
  await expect(page.locator(".topbar__character")).toContainText("Stufe 2");
  await expectOneLanguage(page, "de");
  await shot(page, "91-aufstufen-erste-frage");
  const to2 = await walk(page, 3);
  expect(to2).toEqual(["talents", "knacks"]);
  // Everything chosen before is still on the overview, with a way to change it.
  await expect(page.locator(".summary__item")).toHaveCount(level1.length + 1);
  await finishOnOverview(page, id, 1);
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist jetzt auf Stufe 2!" })).toBeVisible();
  await expect(page.locator(".done__news")).toContainText("Neu:");
  await expect(page.locator(".done__news")).toContainText("Neue Werte:");
  await expect(page.getByText(m["done.reprint"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "92-aufstufen-fertig");

  // 2 → 3, from the end screen: the path is the only new question.
  await page.getByRole("link", { name: m["raise.button"] }).click();
  await expect(page.getByRole("radio", { name: "Stufe 3" })).toBeChecked();
  await page.getByRole("button", { name: "Weiter zu Stufe 3" }).click();
  expect(await walk(page, 2)).toEqual(["path"]);
  await finishOnOverview(page, id, 2);

  // 3 → 5 by number: boon 4 with the raise it brings, and more knacks.
  await page.getByRole("link", { name: m["raise.button"] }).click();
  await page.getByRole("radio", { name: "Andere Stufe" }).check();
  const field = page.getByRole("spinbutton", { name: "Stufe" });
  await expect(field).toHaveValue("5");
  // Not below the next level.
  await page.getByRole("button", { name: "Stufe tiefer" }).click();
  await expect(field).toHaveValue("4");
  await expect(page.getByRole("button", { name: "Stufe tiefer" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Stufe höher" }).click();
  await expect(
    page.getByText("Du beantwortest nur, was auf dem Weg bis Stufe 5 neu dazukommt.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Weiter zu Stufe 5" }).click();
  await expect(page.locator(".progress__text")).toContainText("Schritt 1 von 3");
  await expect(page.locator(".progress__text")).toContainText("Stufe 4");
  const to5 = await walk(page, 3);
  expect(to5).toEqual(["boon-4", "boon-raise@boon-4", "knacks"]);
  // Not one of the steps asked at level 1 to 3 came again, except the knacks that grew.
  expect(to5.filter((k) => level1.includes(k))).toEqual(["knacks"]);
  await finishOnOverview(page, id, 3);
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist jetzt auf Stufe 5!" })).toBeVisible();

  // The printout is the new level.
  const pdf = await page.request.get(`/api/drafts/${id}/pdf`);
  expect(pdf.status()).toBe(200);
});

test("from level 1 to 20 in one go: exactly the questions of levels 2 to 20", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("level-up-20"));
  const id = await finished(page, 1);
  const level1 = await stepIds(page, id);
  const direct = await stepIds(page, await makeLeveled(page, 20));

  await page.goto(`/c/${id}/done`);
  await page.getByRole("link", { name: m["raise.button"] }).click();
  await page.getByRole("radio", { name: "Andere Stufe" }).check();
  await page.getByRole("spinbutton", { name: "Stufe" }).fill("20");
  await page.getByRole("spinbutton", { name: "Stufe" }).press("Enter");
  await page.getByRole("button", { name: "Weiter zu Stufe 20" }).click();
  await expect(page.locator(".progress__text")).toContainText("Schritt 1 von");

  const counted = Number(/von (\d+)/.exec((await page.locator(".progress__text").textContent()) ?? "")![1]);
  const visited = await walk(page, counted);
  // Every step a level-20 character has that a level-1 one did not ...
  expect(visited.filter((k) => !level1.includes(k)).sort()).toEqual(
    direct.filter((k) => !level1.includes(k)).sort(),
  );
  // ... and of the old ones only those that ask more now.
  expect(visited.filter((k) => level1.includes(k)).sort()).toEqual(["knacks", "talents"]);
  await shot(page, "93-aufstufen-20-ueberblick");
  await finishOnOverview(page, id, 1);
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist jetzt auf Stufe 20!" })).toBeVisible();
  // At the top there is no button to go higher.
  await expect(page.getByRole("link", { name: m["raise.button"] })).toHaveCount(0);
});

test("choose for me on a step that grew keeps the old picks, takes nothing twice, and Next runs to the overview", async ({
  page,
  foreign,
}) => {
  void foreign;
  await login(page, uniqueEmail("level-up-keep"));
  // A level-2 herbalist: three root knacks picked by hand, and a borrowed
  // knack that the root knacks offer too (a second source of the same thing).
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  const id = ((await created.json()) as { draft: { id: string } }).draft.id;
  const oldRoots = ["knack.mushroom-glow", "knack.thorn-ring", "knack.herb-scent"];
  await answerRecommended(page, id, {
    level: 2,
    calling: "calling.herbalist",
    answers: [
      ["knacks-root", { picks: oldRoots }],
      ["borrowed-knack", { picks: ["knack.quiet-word"] }],
    ],
  });
  type View = { draft: { version: number; answers: Record<string, { picks?: string[] }> } };
  let view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as View;
  expect(
    (await page.request.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } })).status(),
  ).toBe(200);
  const level2 = await stepIds(page, id);

  await page.goto(`/c/${id}/raise`);
  await page.getByRole("radio", { name: "Andere Stufe" }).check();
  await page.getByRole("spinbutton", { name: "Stufe" }).fill("20");
  await page.getByRole("spinbutton", { name: "Stufe" }).press("Enter");
  await page.getByRole("button", { name: "Weiter zu Stufe 20" }).click();
  await expect(page.locator(".progress__text")).toContainText("Schritt 1 von");
  const counted = Number(/von (\d+)/.exec((await page.locator(".progress__text").textContent()) ?? "")![1]);

  // Straight to the overview, and from there into the first open step: it is
  // open, so it goes on with Next, not back to the overview.
  await page.goto(`/c/${id}/overview`);
  await expect(page.getByText(m["overview.openTitle"])).toBeVisible();
  await page.locator(".summary__item:not(.summary__item--done)").first().getByRole("link").click();
  await expect(page).toHaveURL(/\?from=overview$/);
  await expect(page.getByRole("link", { name: m["flow.backToOverview"] })).toHaveCount(0);
  const first = page.url();
  await page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.locator(".shortcuts__done")).toBeVisible();
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
  await expect(page).not.toHaveURL(first);

  // The rest one after the other with Next, every one a new question.
  const visited = await walk(page, counted);
  expect(visited).toContain("knacks");
  expect(visited.filter((k) => level2.includes(k) && k !== "knacks" && k !== "talents")).toEqual([]);
  // Nothing open at the end: no earlier step had to be answered again.
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);

  // The old root knacks are still there, the borrowed knack too, nothing twice.
  view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as View;
  const answers = view.draft.answers;
  const roots = answers["knacks-root"]!.picks!;
  expect(roots.slice(0, 3)).toEqual(oldRoots);
  expect(roots).toHaveLength(8);
  expect(roots).not.toContain("knack.quiet-word");
  expect(answers["borrowed-knack"]).toEqual({ picks: ["knack.quiet-word"] });

  // "Change" on a finished step still leads back to the overview.
  await page.locator(".summary__item--done").last().getByRole("link").click();
  await expect(page.getByRole("link", { name: m["flow.backToOverview"] })).toBeVisible();
  await page.getByRole("link", { name: m["flow.backToOverview"] }).click();
  await finishOnOverview(page, id, 2);
});

test("a level with no new questions goes straight to the end", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("level-up-quiet"));
  const id = await finished(page, 4);
  await page.goto(`/c/${id}/raise`);
  await page.getByRole("button", { name: "Weiter zu Stufe 5" }).click();
  await expect(page).toHaveURL(`/c/${id}/done?from=4&asked=0`);
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist jetzt auf Stufe 5!" })).toBeVisible();
  await expect(page.getByText("Stufe 5 bringt keine neuen Fragen.", { exact: false })).toBeVisible();
  await shot(page, "94-aufstufen-ohne-fragen");
});

test("a level up can be stopped: the character stays where it was", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("level-up-stop"));
  const id = await finished(page, 1);
  await page.goto(`/c/${id}/raise`);
  await page.getByRole("button", { name: "Weiter zu Stufe 2" }).click();
  await expect(page).toHaveURL(`/c/${id}/step/talents`);
  // Back from the first new question is the choice of level, with the way out.
  await page.getByRole("link", { name: m["common.back"] }).click();
  await expect(page).toHaveURL(`/c/${id}/raise`);
  // The list says where the raise stands.
  await page.goto("/characters");
  await expect(page.locator(".character__status")).toContainText("Steigt auf Stufe 2 · Schritt 1 von 3");
  await page.goto(`/c/${id}/raise`);
  await page.getByRole("button", { name: m["raise.cancel"] }).click();
  const dialog = page.getByRole("dialog", { name: m["raise.cancelTitle"] });
  await expect(dialog).toContainText("Mira bleibt auf Stufe 1.");
  await dialog.getByRole("button", { name: m["raise.cancelConfirm"] }).click();
  await expect(page).toHaveURL(`/c/${id}/done`);
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist fertig!" })).toBeVisible();
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { level: number; levelBefore: number | null; status: string };
  };
  expect(view.draft).toMatchObject({ level: 1, levelBefore: null, status: "finished" });
});

test.describe("in English, on a large screen", () => {
  // The desktop device without its browser type: a group may not switch browsers.
  const { defaultBrowserType: _, ...desktop } = devices["Desktop Chrome"];
  test.use({ ...desktop, viewport: { width: 1366, height: 900 } });

  test("the level-up question and the first new step", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("level-up-en"), "en");
    await finished(page, 1);
    await page.goto("/characters");
    await expectOneLanguage(page, "en");
    await shot(page, "95-level-up-list-desktop");
    await page.getByRole("link", { name: "Level up Mira" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Which level is Mira going up to?" }),
    ).toBeVisible();
    await expect(
      page.getByText("Everything you have chosen stays. You only answer what is new at level 2."),
    ).toBeVisible();
    await expectOneLanguage(page, "en");
    await shot(page, "96-level-up-choice-desktop");
    await page.getByRole("button", { name: "Go on to level 2" }).click();
    await expect(page.locator(".progress__text")).toContainText("Step 1 of 3");
    // The step list shows only the new questions.
    const list = page.getByRole("navigation", { name: en["flow.steps"] });
    await expect(list.locator(".steplist__link")).toHaveCount(3);
    await expectOneLanguage(page, "en");
    await shot(page, "97-level-up-step-desktop");
  });
});
