/**
 * Extensions (format 0.20): the switch under the level, off for a new
 * character, on and off again; locked while an answer comes from it; and the
 * extension's path offered only while it is on. The demo package carries
 * the invented extension "Gezeiten im Nebelland".
 */
import AxeBuilder from "@axe-core/playwright";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import type { DraftView } from "../src/ui/api.ts";
import { answerRecommended, expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

const SWITCH = m["extensions.on"].replace("{name}", "Gezeiten im Nebelland");

test("the level screen switches the extension on and off", async ({ page, foreign }) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "uses the demo extension");
  await signup(page, "gezeiten");
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Welche Stufe hat dein Charakter?" }),
  ).toBeVisible();

  const box = page.getByRole("checkbox", { name: SWITCH });
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(/Manche Texte nur auf Englisch · Nicht zur Weitergabe/);
  await expectOneLanguage(page, "de");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await shot(page, "260-erweiterung-schalter");

  await box.check();
  await expect(page.getByRole("checkbox", { name: SWITCH })).toBeChecked();
  const id = /\/c\/([^/]+)\//.exec(page.url())![1]!;
  const stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as DraftView;
  expect(stored.draft.extensions).toEqual(["demo-tides"]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: SWITCH })).toBeChecked();

  await page.getByRole("checkbox", { name: SWITCH }).uncheck();
  await expect(page.getByRole("checkbox", { name: SWITCH })).not.toBeChecked();
  const after = (await (await page.request.get(`/api/drafts/${id}`)).json()) as DraftView;
  expect(after.draft.extensions).toEqual([]);
});

test("a path from the extension is offered while it is on, and keeps it on", async ({ page, foreign }) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "uses the demo extension");
  await signup(page, "gezeitenpfad");
  const created = await page.request.post("/api/drafts", {
    data: { packageId: "demo", extensions: ["demo-tides"] },
  });
  const id = ((await created.json()) as DraftView).draft.id;
  await answerRecommended(
    page,
    id,
    { level: 3, calling: "calling.river-runner", answers: [["path", { pick: "path.tide-warden" }]] },
    "scores",
  );

  await page.goto(`/c/${id}/step/path`);
  await expect(page.getByRole("radio", { name: /Gezeitenwächter/ })).toBeChecked();

  await page.goto(`/c/${id}/level`);
  const box = page.getByRole("checkbox", { name: SWITCH });
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();
  await expect(box).toHaveAccessibleDescription(
    /Ausschalten geht erst, wenn du diese Wahlen änderst: Spezialisierung\./,
  );
});
