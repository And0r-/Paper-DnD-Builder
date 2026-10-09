/**
 * Asking for help on the overview (AND-331): only while steps are still
 * open, and then inside the yellow box that names them. A character with
 * nothing open has no help block; the menu keeps "Get help" while building.
 */
import de from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, makeCharacter, shot, signup, test } from "./helpers.ts";

const m = de;

test("help on the overview: in the yellow box while steps are open, gone when done", async ({
  page,
  foreign,
}) => {
  void foreign;
  await signup(page, "Ilka");

  // ------------------------------------------------ steps still open
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo", level: 3 } });
  expect(created.status()).toBe(201);
  const open = ((await created.json()) as { draft: { id: string } }).draft.id;
  await page.goto(`/c/${open}/overview`);
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  const box = page.locator(".callout--warning", { hasText: m["overview.openTitle"] });
  await expect(box).toBeVisible();
  await expect(box.getByText(m["overview.helpHint"])).toBeVisible();
  await expect(page.getByText(m["overview.helpHint"])).toHaveCount(1);
  await shot(page, "overview-help-01-offen");
  await box.getByRole("button", { name: m["help.button"] }).click();
  const dialog = page.getByRole("dialog", { name: m["help.title"] });
  await expect(dialog.getByText(m["help.may"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await dialog.getByRole("button", { name: m["common.close"] }).click();
  await expect(dialog).toBeHidden();

  // ------------------------------------------------ everything answered, not printed yet
  const answered = await makeCharacter(page, false);
  await page.goto(`/c/${answered}/overview`);
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);
  await expect(page.getByText(m["overview.helpHint"])).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: m["help.button"] })).toHaveCount(0);

  // ------------------------------------------------ finished
  const done = await makeCharacter(page);
  await page.goto(`/c/${done}/overview`);
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  await expect(page.getByText(m["overview.helpHint"])).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: m["help.button"] })).toHaveCount(0);
  // The language is chosen in the top bar, not on the page.
  await expect(page.getByRole("banner").getByRole("combobox", { name: m["language.label"] })).toBeVisible();
  await expect(page.getByRole("main").getByRole("combobox", { name: m["language.label"] })).toHaveCount(0);
  await shot(page, "overview-help-02-fertig");

  // While building, the menu still offers help.
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await expect(
    page.getByRole("dialog", { name: m["menu.title"] }).getByRole("button", { name: m["help.button"] }),
  ).toBeVisible();
});
