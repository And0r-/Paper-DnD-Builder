/**
 * Texts at an option (format `textInputs`): the demo herbalist picks "far
 * lore" and names two lands. The fields come right under the pick, Next
 * says they are empty, and the sheet writes them after the name.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, makeLeveled, shot, signup, test } from "./helpers.ts";

test("a picked option asks for two lands; Next waits for them; the sheet names them", async ({
  page,
  foreign,
}) => {
  void foreign;
  await signup(page, "option-texts");
  const id = await makeLeveled(page, 1, "calling.herbalist");

  await page.goto(`/c/${id}/step/herb-craft`);
  const first = page.getByRole("textbox", { name: "Erstes Land" });
  const second = page.getByRole("textbox", { name: "Zweites Land" });
  // Only a picked option shows its fields.
  await expect(first).toHaveCount(0);
  await page.getByRole("radio", { name: "Fernkunde" }).check();
  const fields = page.getByRole("group", { name: "Die Felder gehören zu Fernkunde." });
  await expect(fields).toBeVisible();
  await expect(first).toHaveAttribute("placeholder", "z. B. die Salzmarschen");
  await expect(second).toBeEmpty();

  // Next names what is open and takes you to the first empty field.
  const next = page.getByRole("button", { name: m["common.next"], exact: true });
  const reason = page.locator(".step-footer__reason");
  await next.click();
  await expect(reason).toContainText("Schreib noch in die leeren Felder bei Fernkunde.");
  await expect(first).toBeFocused();
  // Choose for me cannot make up names: it is not offered for texts.
  await expect(reason.getByRole("button", { name: m["flow.chooseForMe"] })).toHaveCount(0);

  await first.fill("Salzmarschen");
  await next.click();
  await expect(reason).toContainText("Schreib noch in die leeren Felder bei Fernkunde.");
  await expect(second).toBeFocused();
  await second.fill("Glut-Hügel");
  await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
  await expectOneLanguage(page, "de");
  await shot(page, "62-freitext-an-einer-wahl");

  // Saved on the server as part of the pick; another pick keeps the texts for going back.
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { version: number; answers: Record<string, unknown> };
    evaluation: { complete: boolean };
  };
  expect(view.draft.answers["herb-craft"]).toEqual({
    pick: "trait.far-lore",
    texts: { "trait.far-lore": { first: "Salzmarschen", second: "Glut-Hügel" } },
  });
  expect(view.evaluation.complete).toBe(true);
  await page.getByRole("radio", { name: "Blattkunde" }).check();
  await expect(first).toHaveCount(0);
  await page.getByRole("radio", { name: "Fernkunde" }).check();
  await expect(first).toHaveValue("Salzmarschen");
  await expect(second).toHaveValue("Glut-Hügel");

  // The overview and the sheet write the lands after the name.
  await page.goto(`/c/${id}/overview`);
  await expect(page.getByText("Fernkunde (Salzmarschen, Glut-Hügel)")).toBeVisible();
  const latest = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { version: number };
  };
  const finished = await page.request.post(`/api/drafts/${id}/finish`, {
    data: { version: latest.draft.version },
  });
  expect(finished.status()).toBe(200);
  await page.goto(`/c/${id}/bogen`);
  await expect(page.getByText("Fernkunde (Salzmarschen, Glut-Hügel)").first()).toBeVisible();
  const sheet = await page.request.get(`/api/drafts/${id}/sheet`);
  const model = JSON.stringify(await sheet.json());
  expect(model).toContain("Fernkunde (Salzmarschen, Glut-Hügel)");
});
