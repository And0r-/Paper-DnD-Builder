/**
 * Levels up to 20 (format 0.9): pick level 20, let "choose for me" answer
 * every step (boons, raised scores, knacks by level), finish and download
 * the PDF. Nothing on the way may need a hand.
 */
import { readFile } from "node:fs/promises";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

test("a level-20 character with nothing but choose for me, down to the PDF", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "level-20");
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Welche Stufe hat dein Charakter?" }),
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: "Stufe" }).fill("20");
  await page.getByRole("spinbutton", { name: "Stufe" }).press("Enter");
  await expect(page.locator(".topbar__character")).toContainText("Stufe 20");
  await shot(page, "69-stufe-20-wahl");
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();

  const heading = page.getByRole("heading", { level: 1 });
  const seen: string[] = [];
  let raised = false;
  for (let guard = 0; guard < 60; guard++) {
    await expect(heading).toBeVisible();
    const title = (await heading.textContent()) ?? "";
    if (title === m["overview.question"]) break;
    seen.push(title);
    const choose = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
    const info = page.getByRole("button", { name: m["info.continue"] });
    if (await choose.isVisible()) {
      await choose.click();
      await expect(page.locator(".shortcuts__done")).toContainText(m["flow.choseForMe"]);
      // The first raise of the scores: heart 11 + 2.
      if (title === "Welche Grundwerte werden besser?" && !raised) {
        raised = true;
        await expect(page.getByText("11 + 2 = 13", { exact: true })).toBeVisible();
        await expect(page.getByText(m["dist.allSpent"])).toBeVisible();
        await shot(page, "70-stufe-20-werte-verbessern");
      }
      await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    } else if (await info.isVisible()) {
      await info.click();
    } else {
      await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    }
    // Each step is left before the next round looks at the heading.
    await expect(heading).not.toHaveText(title);
  }
  expect(raised).toBe(true);
  // Five boons, each followed by its raise.
  expect(seen.filter((t) => t === "Welche Grundwerte werden besser?")).toHaveLength(5);
  expect(seen.filter((t) => /^Welche Gabe bekommst du auf Stufe \d+\?$/.test(t))).toHaveLength(5);

  // Overview: nothing open; the raised score lists what raised it.
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);
  await expectOneLanguage(page, "de");
  await shot(page, "71-stufe-20-ueberblick");
  await page.getByRole("button", { name: m["overview.finish"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: /ist fertig!$/ })).toBeVisible();

  // The dialog offers the sheet alone; cards ticked too, both come in one file.
  await page.getByRole("button", { name: m["done.download"] }).click();
  const dialog = page.getByRole("dialog", { name: m["print.title"] });
  await dialog.getByRole("checkbox", { name: m["print.cards"], exact: true }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
  const pdf = await readFile((await (await download).path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // Sheet and cards of a level-20 lantern bearer take several pages.
  const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
  expect(pages.length).toBeGreaterThanOrEqual(3);
});
