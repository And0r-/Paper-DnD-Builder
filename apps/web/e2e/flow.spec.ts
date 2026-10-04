/**
 * Done criterion 1: a level-3 character from login to "finished" in the
 * browser, with the demo package, the way a newcomer would do it (some
 * choices by hand, some with "choose for me"). Screenshots of the main
 * steps go to e2e/screenshots.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

async function next(page: Page) {
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
}

/** Clicks an option card in the main column (the explanation column repeats names on large screens). */
async function pick(page: Page, name: string) {
  await page.getByRole("main").getByText(name, { exact: true }).click();
}

async function question(page: Page, text: string) {
  await expect(page.getByRole("heading", { level: 1, name: text })).toBeVisible();
}

test("a newcomer builds a level-3 character from login to finished", async ({ page, foreign }) => {
  void foreign;
  const email = uniqueEmail("flow");

  await page.goto("/login");
  await expectOneLanguage(page, "de");
  await shot(page, "01-anmelden");
  await axe(page);
  await login(page, email);

  // Empty list, one clear action.
  await expect(page.getByText(m["characters.emptyTitle"])).toBeVisible();
  await shot(page, "02-meine-charaktere-leer");
  await axe(page);
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();

  // Level: one game is loaded, so the game question is skipped.
  await question(page, m["level.question"]);
  await expect(page.getByText("Schritt 1 von")).toBeVisible();
  await pick(page, "3");
  await shot(page, "03-stufe");
  await axe(page);
  await next(page);

  // Your character first: name and one sentence, before any numbers.
  await question(page, "Wer ist dein Charakter?");
  await expect(page.getByText("Schritt 2 von")).toBeVisible();
  await shot(page, "04-dein-charakter");
  await axe(page);
  // Pressing Next too early explains what is missing and offers a name.
  await next(page);
  await expect(page.getByText("Gib deinem Charakter einen Namen.")).toBeVisible();
  await expect(
    page.locator(".step-footer").getByRole("button", { name: m["flow.chooseForMe"] }),
  ).toBeVisible();
  await page.getByLabel("Wie heisst dein Charakter?").fill("Mira");
  await page
    .getByLabel("Beschreib deinen Charakter in einem Satz.")
    .fill("Eine stille Fährfrau, die jeden Weg im Nebel kennt.");
  await expect(page.getByText("Gespeichert ✓")).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "04-dein-charakter-ausgefuellt");
  await next(page);

  // From here on the name stands at the top of every screen.
  await question(page, "Womit verdient dein Charakter sein Brot?");
  await expect(page.locator(".topbar__name")).toHaveText("Mira");
  await expect(page.getByText("Schritt 3 von")).toBeVisible();
  // A package badge replaces "recommended" on the same option.
  await expect(page.locator('[data-option="calling.lantern-bearer"] .badge')).toHaveText("Sanfter Einstieg");
  await expect(page.getByRole("main").getByText(m["common.recommended"], { exact: true })).toHaveCount(0);
  await pick(page, "Laternenträgerin");
  // Calling brings new steps (specialisation, talents, knacks, gear); the count never changes without a word.
  await expect(page.getByText(/Durch deine Wahl kommen 4 Schritte dazu/)).toBeVisible();
  await shot(page, "05-beruf");
  await axe(page);
  await next(page);

  // Info step: nothing to choose, only what you get; the details come later.
  await question(page, "Das bekommst du durch deinen Beruf");
  await shot(page, "09-geschenke");
  await page.getByRole("button", { name: m["info.continue"] }).click();

  // Folk: "learn more" shows the long explanation, units from the settings.
  await question(page, "Woher kommt dein Charakter?");
  await next(page);
  await expect(page.getByText(m["pick.missingOne"])).toBeVisible();
  // A recommendation without a package badge reads "recommended".
  await expect(page.locator('[data-option="folk.moorfolk"] .badge')).toHaveText(m["common.recommended"]);
  await pick(page, "Moorvolk");
  await page.getByRole("button", { name: m["common.moreInfo"] }).first().click();
  await expect(page.getByText(/Dein Tempo ist 7,5 Meter/)).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "10-herkunft-mehr-erfahren");
  await axe(page);
  await next(page);

  // "Choose for me" waits under the intro before Next is ever pressed.
  await question(page, "Wo hat dein Charakter seine Kindheit verbracht?");
  await page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.getByRole("radio", { name: "Fährkind" })).toBeChecked();
  await expect(page.locator(".shortcuts__done")).toBeFocused();
  await expect(page.locator(".shortcuts__done")).toContainText(m["flow.choseForMe"]);
  await next(page);

  // The specialisation shapes the character, so it comes before the numbers.
  await question(page, "Worauf hat sich dein Charakter spezialisiert?");
  await pick(page, "Lichtwächterin");
  await next(page);

  // Scores: spread points with − and +, then let the recommendation finish it.
  await question(page, "Worin ist dein Charakter stark?");
  await expect(page.getByText("Noch 14 Punkte übrig")).toBeVisible();
  await page.getByRole("button", { name: "Herz erhöhen" }).click();
  await expect(page.getByText("Noch 13 Punkte übrig")).toBeVisible();
  await shot(page, "11-grundwerte");
  await axe(page);
  await next(page);

  // Talents: the calling's and the one of level 2 on one step (format 0.8 gather).
  await question(page, "Worin ist dein Charakter geübt?");
  await expect(page.getByText("0 von 2 gewählt")).toBeVisible();
  await next(page);
  await expect(page.getByText("Wähle noch 2 Talent(e).")).toBeVisible();
  // Pressed too early, the dock offers it right above Next as well.
  await page.locator(".step-footer").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.getByText("2 von 2 gewählt")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Lauschen" })).toBeChecked();
  await shot(page, "06-talente");
  await axe(page);
  await next(page);

  // Going back to change the calling asks first and keeps everything on "no".
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /^Beruf/ })
    .click();
  await question(page, "Womit verdient dein Charakter sein Brot?");
  await pick(page, "Flussläufer");
  const dialog = page.getByRole("dialog", { name: "Beruf ändern?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Talente (2 gewählt)")).toBeVisible();
  await shot(page, "07-fruehere-wahl-aendern");
  await expect(dialog.getByRole("button", { name: m["change.keep"] })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radio", { name: "Laternenträgerin" })).toBeChecked();
  // Browser back works like "Back"; we were on the next step before.
  await page.goBack();

  // Knacks: level 3 gives three; units in the facts follow the settings.
  await question(page, "Welche Kniffe kann dein Charakter?");
  await expect(page.getByText("0 von 3 gewählt")).toBeVisible();
  await pick(page, "Warmer Schein");
  await pick(page, "Leuchtfaden");
  await pick(page, "Stilles Wort");
  await expect(page.getByText("3 von 3 gewählt")).toBeVisible();
  await pick(page, "Funkenregen");
  await expect(page.getByText("Du hast schon 3. Nimm erst eine weg.")).toBeVisible();
  await shot(page, "08-kniffe");
  await axe(page);
  await next(page);

  // Gear near the end, once the character is clear.
  await question(page, "Was nimmt dein Charakter zusätzlich mit?");
  await pick(page, "Schilfschild");
  await next(page);

  // Looks last: several questions on one screen, all of them can stay as they are.
  await question(page, "Wie stellst du dir deinen Charakter vor?");
  await page.getByLabel("Wie sieht dein Charakter aus?").fill("Grauer Mantel, eine Laterne am Gürtel.");
  await expect(page.getByText("Gespeichert ✓")).toBeVisible();
  await shot(page, "12-aussehen");
  await axe(page);
  await next(page);

  // Overview: everything at a glance; nothing open.
  await question(page, m["overview.question"]);
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);
  await expect(page.getByText("Laternenträgerin").first()).toBeVisible();
  await expect(page.getByText("Eine stille Fährfrau, die jeden Weg im Nebel kennt.")).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "13-ueberblick");
  await axe(page);
  await page.getByRole("button", { name: m["overview.finish"] }).click();

  // The end.
  await expect(page.getByRole("heading", { level: 1, name: "Mira ist fertig!" })).toBeVisible();
  await expectOneLanguage(page, "de");
  await shot(page, "14-fertig");
  await axe(page);

  // The list shows the finished character.
  await page.getByRole("link", { name: m["done.toList"] }).click();
  await expect(page.getByRole("heading", { name: "Mira" })).toBeVisible();
  await expect(page.getByText("Laternenträgerin · Stufe 3")).toBeVisible();
  await expect(page.getByText(m["characters.finished"])).toBeVisible();
  await shot(page, "15-meine-charaktere");
});
