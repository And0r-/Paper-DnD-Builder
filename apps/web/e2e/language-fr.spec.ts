/**
 * One run in French (AND-254), as a newcomer whose browser speaks French:
 * the login screen is French at once, the password is made of French
 * words, the character is built through the screens and printed. The demo
 * package has no French: its texts come in English, and every screen with
 * them says so in one French sentence.
 */
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, SCREEN, shot, signup, test } from "./helpers.ts";

const m = SCREEN.fr;

test.use({ locale: "fr-FR" });

async function heading(page: Page): Promise<string> {
  return (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";
}

test("a newcomer builds and prints a character in French", async ({ page, foreign }) => {
  void foreign;

  // The browser's language decides before anyone chooses.
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 2, name: m["login.registerTitle"] })).toBeVisible();
  await shot(page, "fr-01-connexion");

  const password = await signup(page, "Élodie", "fr");
  // Five words from the French list and a number: plain a-z, typed on any phone.
  expect(password).toMatch(/^([a-z]{3,10}-){5}\d{4}$/u);
  await expect(page.getByText(m["characters.emptyTitle"])).toBeVisible();
  await shot(page, "fr-02-mes-personnages");
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();

  // The game is shown in English, and the screen says so in French.
  const note = m["package.otherLanguage"].replace("{language}", "français").replace("{shown}", "anglais");
  await expect(page.getByText(note)).toBeVisible();
  await shot(page, "fr-03-niveau");

  // Through every step: a name where one is asked, "choose for me" where offered, then Next.
  const overview = page.getByRole("heading", { level: 1, name: m["overview.question"] });
  for (let i = 0; i < 40 && !(await overview.isVisible()); i++) {
    const before = await heading(page);
    const name = page.getByLabel("What is your character's name?");
    if (await name.isVisible()) {
      await name.fill("Élodie Peña");
      await expect(page.getByText(m["save.saved"])).toBeVisible();
    }
    const choose = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
    if (await choose.isVisible()) await choose.click();
    const info = page.getByRole("button", { name: m["info.continue"] });
    if (await info.isVisible()) await info.click();
    else await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    await expect.poll(() => heading(page)).not.toBe(before);
  }
  await expect(overview).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();
  await shot(page, "fr-04-apercu");
  await page.getByRole("button", { name: m["overview.finish"] }).click();

  // The end: the download dialog in French, the PDF named in French.
  const download = page.getByRole("button", { name: m["done.download"] });
  await expect(download).toBeVisible();
  await shot(page, "fr-05-termine");
  await download.click();
  const dialog = page.getByRole("dialog", { name: m["print.title"] });
  await expect(dialog.getByRole("radio", { name: "Détaillée", exact: true })).toBeChecked();
  await shot(page, "fr-06-telecharger");
  const file = page.waitForEvent("download");
  await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
  const done = await file;
  // The game has no French, so the printout is all English: one language per document.
  expect(done.suggestedFilename()).toBe("Élodie Peña - Detailed - Sheet, Cards.pdf");
  const pdf = await readFile((await done.path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
});
