/**
 * One run in French, Italian and Spanish (AND-254), as a newcomer whose browser speaks it:
 * the login screen is French at once, the password is made of French
 * words, the character is built through the screens and printed. The demo
 * package has no French: its texts come in English, and every screen with
 * them says so in one French sentence.
 */
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, SCREEN, shot, signup, test } from "./helpers.ts";

const RUNS = [
  { lang: "fr", locale: "fr-FR", name: "Élodie Peña", file: "Elodie Pena" },
  { lang: "it", locale: "it-IT", name: "Niccolò Peña", file: "Niccolo Pena" },
  { lang: "es", locale: "es-ES", name: "Begoña Núñez", file: "Begona Nunez" },
] as const;

async function heading(page: Page): Promise<string> {
  return (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";
}

for (const { lang, locale, name: fullName, file: fileName } of RUNS) {
  test.describe(lang, () => {
    test.use({ locale });

    test(`a newcomer builds and prints a character (${lang})`, async ({ page, foreign }) => {
      void foreign;
      const m = SCREEN[lang];
      const shown = (code: string) => new Intl.DisplayNames([lang], { type: "language" }).of(code)!;

      // The browser's language decides before anyone chooses.
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("heading", { level: 2, name: m["login.registerTitle"] })).toBeVisible();
      await shot(page, `${lang}-01-login`);

      const password = await signup(page, fullName.split(" ")[0]!, lang);
      // Five words from the language's list and a number: plain a-z, typed on any phone.
      expect(password).toMatch(/^([a-z]{3,10}-){5}\d{4}$/u);
      await expect(page.getByText(m["characters.emptyTitle"])).toBeVisible();
      await shot(page, `${lang}-02-characters`);
      await page.getByRole("link", { name: m["characters.emptyAction"] }).click();

      // The game is shown in English, and the screen says so in French.
      const note = m["package.otherLanguage"]
        .replace("{language}", shown(lang))
        .replace("{shown}", shown("en"));
      await expect(page.getByText(note)).toBeVisible();
      await shot(page, `${lang}-03-level`);

      // Through every step: a name where one is asked, "choose for me" where offered, then Next.
      const overview = page.getByRole("heading", { level: 1, name: m["overview.question"] });
      for (let i = 0; i < 40 && !(await overview.isVisible()); i++) {
        const before = await heading(page);
        const name = page.getByLabel("What is your character's name?");
        if (await name.isVisible()) {
          await name.fill(fullName);
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
      await shot(page, `${lang}-04-overview`);
      await page.getByRole("button", { name: m["overview.finish"] }).click();

      // The end: the download dialog in French, the PDF named in French.
      const download = page.getByRole("button", { name: m["done.download"] });
      await expect(download).toBeVisible();
      await shot(page, `${lang}-05-done`);
      await download.click();
      const dialog = page.getByRole("dialog", { name: m["print.title"] });
      const detailed = { fr: "Détaillée", it: "Dettagliata", es: "Detallada" }[lang];
      await expect(dialog.getByRole("radio", { name: detailed, exact: true })).toBeChecked();
      await shot(page, `${lang}-06-download`);
      const file = page.waitForEvent("download");
      await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
      const done = await file;
      // The game has no French, so the printout is all English: one language per document.
      // The name is ASCII: a browser without a UTF-8 locale saved "Élodie" as "download", without ".pdf".
      expect(done.suggestedFilename()).toBe(`${fileName} - Detailed - Sheet, Cards.pdf`);
      const pdf = await readFile((await done.path())!);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });
}
