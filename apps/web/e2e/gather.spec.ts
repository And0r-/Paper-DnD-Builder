/**
 * Gather steps (SPEC 9.4): one shared list for the talents of several
 * sources, with a counter per source, what the character already has on
 * top, and greyed options with the reason in words. And the knacks of
 * two sources on one screen.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { animationsDone, expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

/** A level-3 character of the coastfolk, raised as a ferry child, made through the API. */
async function coastfolk(page: Page, calling: string): Promise<string> {
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await req.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  const answers: [string, unknown][] = [
    ["name", { text: "Mira" }],
    ["calling", { pick: calling }],
    ["folk", { pick: "folk.coastfolk" }],
    ["upbringing", { pick: "upbringing.ferry-child" }],
  ];
  for (const [choice, answer] of answers) {
    const r = await req.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }
  return id;
}

const option = (page: Page, id: string) => page.locator(`[data-option="${id}"]`);

test("one list for the talents of three sources", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("gather"));
  const id = await coastfolk(page, "calling.lantern-bearer");

  await page.goto(`/c/${id}/step/talents`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Worin ist dein Charakter geübt?");
  // Three sources, each named by the package's words.
  const sources = "2 aus deinem Beruf, 1 aus Stufe 2 und 1 aus deiner Herkunft";
  await expect(page.locator("[data-pool-total]")).toHaveText(`Du wählst 4: ${sources}.`);
  // What the upbringing gave is on top, not in the list; so is what every character has (flow.grants).
  await expect(page.locator("[data-pool-held] li")).toHaveText([
    "Nebelzeichen (alle)",
    "Wetterkunde und Feilschen (von Fährkind)",
  ]);
  await expect(option(page, "talent.weather-sense")).toHaveCount(0);
  await expect(option(page, "talent.haggling")).toHaveCount(0);
  await expectOneLanguage(page, "de");
  await shot(page, "70-talente-drei-quellen");
  await axe(page);

  // Next too early: the footer names the open sources.
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
  await expect(page.locator(".step-footer")).toContainText(`Noch 4 offen: ${sources}.`);

  // Listening (folk or level) and tracking (level only) fill those two.
  await page.getByRole("checkbox", { name: "Lauschen" }).check();
  await page.getByRole("checkbox", { name: "Spurenlesen" }).check();
  await expect(page.locator("[data-pool-counter]")).toHaveText("Noch offen: 2 aus deinem Beruf");
  // Sneaking comes from the level only: greyed, with the reason in words, still focusable.
  const sneaking = option(page, "talent.sneaking");
  await expect(sneaking).toHaveClass(/option--blocked/);
  await expect(sneaking).toContainText(
    "Dafür ist keine Wahl mehr frei. Das gibt es nur aus Stufe 2, und dort ist schon alles gewählt.",
  );
  await page.getByRole("checkbox", { name: "Schleichen" }).click({ force: true });
  await expect(page.getByRole("checkbox", { name: "Schleichen" })).not.toBeChecked();
  // Climbing is offered by the calling too, so it stays open.
  await expect(option(page, "talent.climbing")).not.toHaveClass(/option--blocked/);
  await expect(page.locator(".step-footer")).toContainText("Noch 2 offen: aus deinem Beruf.");
  await shot(page, "71-talente-grau-mit-grund");
  await axe(page);

  // Keyboard: Tab reaches the greyed option, Space does nothing to it; Space picks a free one.
  await page.getByRole("checkbox", { name: "Schleichen" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Schleichen" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Klettern" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Klettern" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Heilkunde" }).check();
  await expect(page.locator("[data-pool-counter]")).toHaveText("Fertig: alle 4 gewählt.");
  await expect(page.getByText(m["save.saved"])).toBeVisible();

  // Untick one and "choose for me" fills the whole list again.
  await page.getByRole("checkbox", { name: "Heilkunde" }).uncheck();
  await page.getByRole("button", { name: m["flow.chooseForMe"] }).first().click();
  await expect(page.locator("[data-pool-counter]")).toHaveText("Fertig: alle 4 gewählt.");
  await expect(page.getByText(m["save.saved"])).toBeVisible();

  // Saved as one answer per choice: the API sees the same choices as before.
  const saved = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { answers: Record<string, unknown> };
  };
  expect(Object.keys(saved.draft.answers)).toEqual(
    expect.arrayContaining(["talents-lantern-bearer", "coastfolk-talent", "extra-talent"]),
  );
});

test("the knacks of two sources on one screen", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("gather-knacks"));
  const id = await coastfolk(page, "calling.herbalist");

  await page.goto(`/c/${id}/step/knacks`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welche Kniffe kann dein Charakter?");
  // Each choice keeps its own question under the step's.
  const sections = page.locator(".subquestion");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0).locator(".subquestion__title")).toHaveText(
    "Welche Kniffe kann dein Charakter?",
  );
  await expect(sections.nth(1).locator(".subquestion__title")).toHaveText(
    "Welchen Kniff hast du dir bei anderen abgeschaut?",
  );
  await expectOneLanguage(page, "de");
  await shot(page, "72-kniffe-ein-bildschirm");
  await axe(page);
  // "Choose for me" answers both sections: 3 plus 1.
  await page.getByRole("button", { name: m["flow.chooseForMe"] }).first().click();
  await expect(page.getByText(m["flow.choseForMe"])).toBeVisible();
  await expect(page.locator(".subquestion input:checked")).toHaveCount(4);
});

test("the calling's gifts name the choices that come later", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("gather-later"));
  const id = await coastfolk(page, "calling.lantern-bearer");

  await page.goto(`/c/${id}/step/calling-gifts`);
  const later = page.locator(".gifts__choices").filter({ hasText: m["info.later"] });
  await expect(later).toBeVisible();
  await expect(later).toContainText("Talente");
  await expect(later).toContainText("im Schritt Talente");
  await expectOneLanguage(page, "de");
  await shot(page, "73-geschenke-spaeter");
  await axe(page);
});
