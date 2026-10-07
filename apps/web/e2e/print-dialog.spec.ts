/**
 * The download dialog of the done screen (AND-179): only the sheet is
 * ticked at first, each part comes as the file it says, and the account
 * keeps the choice for next time. Both languages, one at a time.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  animationsDone,
  expect,
  expectOneLanguage,
  login,
  makeCharacter,
  shot,
  test,
  uniqueEmail,
} from "./helpers.ts";

const MESSAGES = { de, en };
/** The part words in file names, as the server's print words have them. */
const FILE_WORDS = {
  de: { sheet: "Bogen", cards: "Karten", texts: "Regeltexte", design: "Ausführlich" },
  en: { sheet: "Sheet", cards: "Cards", texts: "Rules texts", design: "Detailed" },
};

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

for (const lang of ["de", "en"] as const) {
  test(`the download dialog offers the sheet alone first and keeps the choice (${lang})`, async ({
    page,
    foreign,
  }) => {
    void foreign;
    const m = MESSAGES[lang];
    const words = FILE_WORDS[lang];
    await login(page, uniqueEmail(`print-${lang}`), lang);
    const id = await makeCharacter(page);
    await page.goto(`/c/${id}/done`);

    const open = async () => {
      await page.getByRole("button", { name: m["done.download"] }).click();
      const dialog = page.getByRole("dialog", { name: m["print.title"] });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    let dialog = await open();
    const part = (key: "print.sheet" | "print.cards" | "print.texts") =>
      dialog.getByRole("checkbox", { name: m[key], exact: true });
    const download = async (expected: string) => {
      const file = page.waitForEvent("download");
      await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
      const done = await file;
      expect(done.suggestedFilename()).toBe(expected);
      await expect(dialog).toBeHidden();
      return readFile((await done.path())!);
    };

    // Only the sheet, nothing else ticked; the first design; no copy, so the original; empty.
    await expect(part("print.sheet")).toBeChecked();
    await expect(part("print.cards")).not.toBeChecked();
    await expect(part("print.texts")).not.toBeChecked();
    await expect(dialog.getByText(m["sheet.original"])).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: m["print.state"] })).not.toBeChecked();
    await expect(dialog.getByRole("combobox", { name: m["print.version"] })).toHaveCount(0);
    const design = (name: string) => dialog.getByRole("radio", { name, exact: true });
    await expect(design(lang === "de" ? "Ausführlich" : "Detailed")).toBeChecked();
    await expect(design(lang === "de" ? "Klassisch" : "Classic")).not.toBeChecked();
    await expectOneLanguage(page, lang);
    await axe(page);
    await shot(page, `95-download-dialog-${lang}`);

    // The sheet alone: fewer pages than sheet and cards together.
    // The design in the name, so a sheet in the other design does not overwrite it.
    const sheet = await download(`Mira - ${words.design} - ${words.sheet}.pdf`);
    expect(sheet.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const both = await page.request.get(`/api/drafts/${id}/pdf`);
    expect(pages(sheet)).toBeLessThan(pages(await both.body()));

    // Cards and rules texts instead: one file, in that order; a tap on the card's text ticks it too.
    dialog = await open();
    await part("print.sheet").click();
    await expect(part("print.sheet")).not.toBeChecked();
    await dialog.getByText(m["print.cardsText"]).click();
    await part("print.texts").click();
    await expect(part("print.cards")).toBeChecked();
    await download(`Mira - ${words.cards}, ${words.texts}.pdf`);

    // Kept on the account: after a reload the dialog starts from it.
    await page.reload();
    dialog = await open();
    await expect(part("print.sheet")).not.toBeChecked();
    await expect(part("print.cards")).toBeChecked();
    await expect(part("print.texts")).toBeChecked();
    const account = (await (await page.request.get("/api/account")).json()) as {
      account: { print: { parts: string[] } };
    };
    expect(account.account.print.parts).toEqual(["cards", "texts"]);

    // Nothing ticked: it says so instead of downloading an empty file.
    await part("print.cards").click();
    await part("print.texts").click();
    await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(m["print.noPart"]);
    await expect(dialog).toBeVisible();
    await expectOneLanguage(page, lang);

    // Escape closes without downloading, back on the button that opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: m["done.download"] })).toBeFocused();
  });
}

test("prints a kept copy with the play state filled in, and keeps the play state choice", async ({
  page,
  foreign,
}) => {
  void foreign;
  const m = de;
  await login(page, uniqueEmail("print-copy"), "de");
  const id = await makeCharacter(page);
  const made = (await (await page.request.post(`/api/drafts/${id}/sheet-copies`, { data: {} })).json()) as {
    copy: { id: string; createdAt: string };
  };
  await page.request.put(`/api/drafts/${id}/state`, {
    data: { version: 0, state: { "sheet/notes/notes": "Zwei Münzen beim Fährmann" } },
  });
  await page.goto(`/c/${id}/done`);
  await page.getByRole("button", { name: m["done.download"] }).click();
  const dialog = page.getByRole("dialog", { name: m["print.title"] });
  const version = dialog.getByRole("combobox", { name: m["print.version"] });
  await expect(version).toHaveValue("original");
  // Named as on the sheet: "Meine Fassung vom 7. Oktober, 14:20".
  const at = new Date(made.copy.createdAt);
  const name = m["sheet.copyName"]
    .replace("{date}", new Intl.DateTimeFormat("de", { day: "numeric", month: "long" }).format(at))
    .replace("{time}", new Intl.DateTimeFormat("de", { hour: "2-digit", minute: "2-digit" }).format(at));
  await version.selectOption({ label: name });
  await dialog.getByRole("checkbox", { name: m["print.state"] }).check();
  await expectOneLanguage(page, "de");
  await axe(page);
  await shot(page, "97-download-dialog-fassung-de");

  const asked = page.waitForRequest(/\/pdf\?/);
  const file = page.waitForEvent("download");
  await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
  const query = new URL((await asked).url()).searchParams;
  expect([query.get("version"), query.get("state")]).toEqual([made.copy.id, "filled"]);
  const pdf = await readFile((await (await file).path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/account")).json()) as { account: { print: { state: string } } })
          .account.print.state,
    )
    .toBe("filled");
});

test("a character without cards cannot tick them, and keeps the wish for the next one", async ({
  page,
  foreign,
}) => {
  void foreign;
  const m = de;
  await login(page, uniqueEmail("print-nocards"), "de");
  const id = await makeCharacter(page);
  await page.request.patch("/api/account/settings", { data: { print: { parts: ["sheet", "cards"] } } });
  // The same package where nothing is a card.
  await page.route(/\/api\/packages\/demo$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { package: { things: { card?: boolean }[] } };
    for (const t of body.package.things) delete t.card;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/c/${id}/done`);
  await page.getByRole("button", { name: m["done.download"] }).click();
  const dialog = page.getByRole("dialog", { name: m["print.title"] });
  const cards = dialog.getByRole("checkbox", { name: m["print.cards"], exact: true });
  await expect(cards).toBeDisabled();
  await expect(cards).not.toBeChecked();
  await expect(dialog.getByText(m["print.cardsNone"])).toBeVisible();
  await shot(page, "96-download-dialog-ohne-karten-de");
  const file = page.waitForEvent("download");
  await dialog.getByRole("button", { name: m["print.download"], exact: true }).click();
  expect((await file).suggestedFilename()).toBe("Mira - Ausführlich - Bogen.pdf");
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get("/api/account")).json()) as {
            account: { print: { parts: string[] } };
          }
        ).account.print.parts,
    )
    .toEqual(["sheet", "cards"]);
});
