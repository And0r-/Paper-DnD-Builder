/**
 * A text field and a text changed elsewhere (AND-268), against the real
 * server: the owner and the game master of the campaign on the same
 * character. The field shows a text someone else saved. Someone in the
 * field is asked instead of overwritten, and "Saved" is said only while
 * the field shows what is saved.
 */
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]!);
}

const nameField = (page: Page) => page.locator("#choice-name");
const theirs = (page: Page) => page.locator("[data-theirs]");
const status = (page: Page) => page.locator(".save-status");

async function gameMasterBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: DESKTOP,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + 17) % 250}` },
  });
  return context.newPage();
}

/** Lio (owner, `page`, German) plays in Vexa's campaign; a level-3 character of Lio's in it. */
async function table(page: Page, gm: Page): Promise<string> {
  await signup(gm, "Vexa", "en");
  const made = await gm.request.post("/api/campaigns", { data: { name: "Thursday" } });
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  await signup(page, "Lio", "de");
  const token = new URL(campaign.inviteUrl).pathname.split("/").at(-1)!;
  expect((await page.request.post(`/api/invites/${token}/join`)).status()).toBe(200);
  const r = await page.request.post("/api/drafts", {
    data: { packageId: "demo", level: 3, campaignId: campaign.id },
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { draft: { id: string } }).draft.id;
}

async function storedName(request: APIRequestContext, id: string): Promise<unknown> {
  const v = (await (await request.get(`/api/drafts/${id}`)).json()) as {
    draft: { answers: Record<string, unknown> };
  };
  return v.draft.answers["name"];
}

test("a name changed elsewhere shows in the field; someone in the field is asked, not overwritten", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await page.setViewportSize(DESKTOP);
  const gm = await gameMasterBrowser(browser);
  const id = await table(page, gm);
  await page.goto(`/c/${id}/step/character`);
  await gm.goto(`/c/${id}/step/character`);
  await expect(nameField(page)).toBeVisible();
  await expect(nameField(gm)).toBeVisible();

  // The game master writes a name; the owner is not in the field: it follows.
  await nameField(gm).fill("Lina vom Moor");
  await nameField(gm).blur();
  await expect(status(gm)).toHaveText(en["save.saved"]);
  await expect(nameField(page)).toHaveValue("Lina vom Moor");
  await expect(status(page)).toHaveText(de["save.saved"]);
  await expect(theirs(page)).toHaveCount(0);
  await expectOneLanguage(page, "de");
  await shot(page, "268-name-folgt-de");

  // The owner is in the field and has written; the game master changes it meanwhile.
  await nameField(page).fill("Lina");
  await expect(status(page)).toHaveText(de["save.saved"]);
  await expect(nameField(gm)).toHaveValue("Lina");
  await nameField(gm).fill("Lina Nebelgrund");
  await nameField(gm).blur();
  await expect(theirs(page)).toBeVisible();
  const from = fill(de["live.from.person"], { who: fill(de["live.person.gameMaster"], { name: "Vexa" }) });
  await expect(theirs(page)).toContainText(fill(de["text.theirs"], { from, text: "Lina Nebelgrund" }));
  await expect(theirs(page)).toContainText(de["text.keepQuestion"]);
  // The owner's text stays in the field, and "Saved" is not said beside it.
  await expect(nameField(page)).toHaveValue("Lina");
  await expect(status(page)).toHaveText(de["save.unsaved"]);
  // Typing on does not overwrite the other text.
  await nameField(page).pressSequentially(" Ross");
  await expect(nameField(page)).toHaveValue("Lina Ross");
  expect(await storedName(page.request, id)).toEqual({ text: "Lina Nebelgrund" });
  await expectOneLanguage(page, "de");
  await shot(page, "268-name-frage-de");

  // "Keep mine" saves the owner's text; the game master's field follows.
  await theirs(page).getByRole("button", { name: de["text.keepMine"] }).click();
  await expect(theirs(page)).toHaveCount(0);
  await expect(status(page)).toHaveText(de["save.saved"]);
  await expect(nameField(gm)).toHaveValue("Lina Ross");
  expect(await storedName(page.request, id)).toEqual({ text: "Lina Ross" });

  // Again, and this time the owner takes the new one.
  await nameField(page).focus();
  await nameField(gm).fill("Brin");
  await nameField(gm).blur();
  await expect(theirs(page)).toBeVisible();
  await expect(nameField(page)).toHaveValue("Lina Ross");
  await theirs(page).getByRole("button", { name: de["text.takeTheirs"] }).click();
  await expect(nameField(page)).toHaveValue("Brin");
  await expect(theirs(page)).toHaveCount(0);
  await expect(status(page)).toHaveText(de["save.saved"]);
  expect(await storedName(page.request, id)).toEqual({ text: "Brin" });

  // Over the API (as a language model would), with nobody in the field: it simply follows.
  await page.locator("h1").first().click();
  const v = (await (await gm.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const r = await gm.request.put(`/api/drafts/${id}/answers/name`, {
    data: { version: v.draft.version, answer: { text: "Mara" } },
  });
  expect(r.status()).toBe(200);
  await expect(nameField(page)).toHaveValue("Mara");
  await expect(nameField(gm)).toHaveValue("Mara");
  await expect(theirs(page)).toHaveCount(0);
  await gm.context().close();
});
