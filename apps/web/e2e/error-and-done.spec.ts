/**
 * Person B's findings (AND-30): the error screen after a failed load speaks
 * the screen language, and the done screen promises cards only when the
 * printout has some.
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, makeCharacter, shot, test, uniqueEmail } from "./helpers.ts";

const MESSAGES = { de, en };

/**
 * Code files fetched from now on fail, as after a rebuild while the page was
 * open. Next.js then loads the page anew by itself. With `stayLost`, the
 * files that failed before keep failing after that load; else the new load
 * brings them.
 */
async function loseNewChunks(page: Page, stayLost = false): Promise<void> {
  const lost = new Set<string>();
  let reloaded = false;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) reloaded = true;
  });
  await page.route("**/_next/static/chunks/**", (route) => {
    const url = route.request().url();
    if (!reloaded) lost.add(url);
    return lost.has(url) && (!reloaded || stayLost) ? route.abort("failed") : route.continue();
  });
}

/** Opens the settings through the menu: a screen whose code is not loaded yet. */
async function openSettings(page: Page, m: typeof de) {
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await page.getByRole("link", { name: m["menu.settings"] }).click();
}

for (const lang of ["de", "en"] as const) {
  test(`a failed load reloads by itself, else explains in ${lang} only`, async ({ page, foreign }) => {
    void foreign;
    const m = MESSAGES[lang];
    await login(page, uniqueEmail(`chunk-${lang}`), lang);
    await page.waitForLoadState("networkidle");

    // Usually one automatic reload fetches the new code and the screen just opens.
    await loseNewChunks(page);
    await openSettings(page, m);
    await expect(page.getByRole("heading", { level: 1, name: m["settings.title"] })).toBeVisible();
    await page.unrouteAll();

    // Right after such a reload there is no second one: the error screen shows, in the screen language.
    await page.goto("/characters");
    await expect(page.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => sessionStorage.setItem("builder.chunkReloadAt", String(Date.now())));
    await loseNewChunks(page, true);
    await openSettings(page, m);
    await expect(page.getByText(m["common.errorTitle"])).toBeVisible();
    await expect(page.getByText(m["common.errorText"])).toBeVisible();
    await expect(page.getByRole("button", { name: m["common.reload"] })).toBeVisible();
    await expect(page.getByRole("button", { name: m["common.back"] })).toBeVisible();
    await expect(page.getByText(/couldn.t load/i)).toHaveCount(0);
    await expectOneLanguage(page, lang);
    await shot(page, `60-fehlerseite-${lang}`);

    // Reload works once the code is there again.
    await page.unrouteAll();
    await page.getByRole("button", { name: m["common.reload"] }).click();
    await expect(page.getByRole("heading", { level: 1, name: m["settings.title"] })).toBeVisible();
  });

  test(`the done screen mentions cards only when the printout has some (${lang})`, async ({
    page,
    foreign,
  }) => {
    void foreign;
    const m = MESSAGES[lang];
    await login(page, uniqueEmail(`done-${lang}`), lang);
    const id = await makeCharacter(page);
    const title = m["done.title"].replace("{name}", "Mira");

    // The demo character holds knacks, which are cards.
    await page.goto(`/c/${id}/done`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(m["done.text"])).toBeVisible();
    await expect(page.getByText(m["done.tip"])).toBeVisible();
    await expectOneLanguage(page, lang);
    await shot(page, `61-fertig-mit-karten-${lang}`);

    // The same package where nothing is a card: only the sheet is promised.
    await page.route(/\/api\/packages\/demo$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { package: { things: { card?: boolean }[] } };
      for (const t of body.package.things) delete t.card;
      await route.fulfill({ response: res, json: body });
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(m["done.textSheetOnly"])).toBeVisible();
    await expect(page.getByText(m["done.tipSheetOnly"])).toBeVisible();
    await expect(page.getByText(m["done.text"])).toHaveCount(0);
    await expect(page.getByText(m["done.tip"])).toHaveCount(0);
    await expectOneLanguage(page, lang);
    await shot(page, `62-fertig-ohne-karten-${lang}`);
  });
}
