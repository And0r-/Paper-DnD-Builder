/**
 * A choice's intro for this character (format 0.6): the number of talents
 * comes from the rule core, and only hillfolk read why they get one more.
 * One language on screen, in German and in English.
 */
import type { Page } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

/** A level-1 river runner of the given folk, made through the API. */
async function riverRunner(page: Page, folk: string): Promise<string> {
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  let view = (await created.json()) as { draft: { id: string; version: number } };
  for (const [choice, answer] of [
    ["folk", { pick: folk }],
    ["calling", { pick: "calling.river-runner" }],
  ] as const) {
    const r = await req.put(`/api/drafts/${view.draft.id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }
  return view.draft.id;
}

async function intro(page: Page, id: string, lang: "de" | "en", text: string, name: string) {
  await page.goto(`/c/${id}/step/talents-river-runner`);
  await expect(page.locator(".question__intro")).toHaveText(text);
  await expectOneLanguage(page, lang);
  await shot(page, name);
}

test("the talent intro names the count and, for hillfolk only, the reason", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("variants"));
  const hill = await riverRunner(page, "folk.hillfolk");
  const moor = await riverRunner(page, "folk.moorfolk");

  await intro(
    page,
    hill,
    "de",
    "Als Flussläufer lernst du 3 Talente, eins mehr als die anderen: Das Bergvolk lernt viel von seinen Alten. Wähle die, die zu deinem Charakter passen.",
    "31-talente-bergvolk",
  );
  await intro(
    page,
    moor,
    "de",
    "Als Flussläufer lernst du 2 Talente. Wähle die, die zu deinem Charakter passen.",
    "32-talente-moorvolk",
  );

  await page.goto("/settings");
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();

  await intro(
    page,
    hill,
    "en",
    "As a River Runner, you learn 3 talents, one more than others: the hillfolk learn a lot from their elders. Pick the ones that fit your character.",
    "33-talents-hillfolk-en",
  );
  await intro(
    page,
    moor,
    "en",
    "As a River Runner, you learn 2 talents. Pick the ones that fit your character.",
    "34-talents-moorfolk-en",
  );
});
