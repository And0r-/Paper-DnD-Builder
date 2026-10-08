/**
 * The track screens on sample data (AND-276): every screen and sample in
 * German and English on a phone, one language only, no axe findings; then
 * the moves a player makes with the keyboard: pick a new track on level up,
 * split the levels and take it back.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { animationsDone, expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

const SCREENS = ["raise", "step", "unfit", "overview", "sheet"] as const;

async function open(page: Page, s: string, v: string) {
  await page.goto(`/preview/tracks?s=${s}&v=${v}`);
  await expect(page.locator("h1, .tracks-head__name, .tracks-sheet__name").first()).toBeVisible();
}

for (const lang of ["de", "en"] as const) {
  test(`track screens in ${lang}: one language, no axe findings`, async ({ page, foreign }) => {
    void foreign;
    // The package structure is for accounts only.
    await signup(page, "Probe", lang);
    for (const s of ["1", "2", "3"]) {
      for (const v of SCREENS) {
        await open(page, s, v);
        await expectOneLanguage(page, lang);
        await animationsDone(page);
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(r.violations, `${lang} ${s} ${v}`).toEqual([]);
        await shot(page, `tracks-${lang}-${v}-${s}`);
      }
    }
  });
}

test("level up into a new track; a refused one stays as it is", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Probe", "de");
  await open(page, "1", "raise");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stufe 4: Wie wächst Mira?");
  const keep = page.getByRole("radio", { name: "Weiter als Flussläufer" });
  await expect(keep).toBeChecked();
  await expect(page.getByText("Danach: Flussläufer, Stufe 4.")).toBeVisible();
  // With the keyboard: from the checked card to the next one.
  await keep.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Kräuterkundige" })).toBeChecked();
  await expect(page.getByText("Danach: Flussläufer 3 / Kräuterkundige 1.")).toBeVisible();
  // A refused track says why and is never chosen.
  const refused = page.locator('[data-track="calling.lantern-bearer"]');
  await expect(refused).toContainText("Geht nicht: Braucht Herz 13. Mira hat 10.");
  await refused.click();
  await expect(page.getByRole("radio", { name: "Laternenträgerin" })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Kräuterkundige" })).toBeChecked();
});

test("several new levels: one question each, the line follows", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Probe", "en");
  await open(page, "3", "raise");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Up to Level 10: how does Ennu grow?");
  await expect(page.getByRole("group", { name: "What does Level 9 bring?" })).toBeVisible();
  await expect(page.getByRole("group", { name: "What does Level 10 bring?" })).toBeVisible();
  await expect(page.getByText("Afterwards: Lantern Bearer 6 / Herbalist 4.")).toBeVisible();
  await page
    .getByRole("group", { name: "What does Level 10 bring?" })
    .getByRole("radio", { name: "Carry on as Lantern Bearer" })
    .check();
  await expect(page.getByText("Afterwards: Lantern Bearer 7 / Herbalist 3.")).toBeVisible();
});

test("level by level: split, see the result, all back in one", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Probe", "de");
  await open(page, "1", "step");
  await expect(page.getByText("Stufe 1 bis 3: alles als Flussläufer.")).toBeVisible();
  await page.getByRole("button", { name: "Aufteilen" }).click();
  await expect(page.getByRole("heading", { name: "Jede Stufe einzeln" })).toBeFocused();
  const third = page.getByRole("combobox", { name: "Stufe 3" });
  await third.selectOption({ label: "Kräuterkundige" });
  await expect(page.getByText("Ergibt: Flussläufer 2 / Kräuterkundige 1")).toBeVisible();
  // A refused track is in the list, cannot be chosen, and the reason is written out.
  await expect(third.locator("option", { hasText: "Laternenträgerin (geht nicht)" })).toBeDisabled();
  await expect(page.getByText("Laternenträgerin: Braucht Herz 13. Mira hat 10.")).toBeVisible();
  await page.getByRole("button", { name: "Wieder alles als Flussläufer" }).click();
  await expect(page.getByText("Ergibt: Flussläufer, Stufe 3")).toBeVisible();
});

test("a track that no longer fits is named with its levels", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Probe", "de");
  await open(page, "2", "unfit");
  await expect(page.getByText("Das passt nicht mehr")).toBeVisible();
  await expect(
    page.getByText("Flussläufer auf Stufe 2, 3, 4 und 5: Braucht Geschick 13. Tobi hat jetzt 12."),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Stufe 2" })).toHaveAttribute("aria-invalid", "true");
});

test("head line: most levels first", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Probe", "en");
  await open(page, "2", "overview");
  await expect(page.locator(".tracks-head__line")).toContainText("River Runner 4 / Lantern Bearer 1");
  await open(page, "3", "sheet");
  await expect(page.locator(".tracks-sheet__line")).toHaveText("Lantern Bearer 6 / Herbalist 2");
});
