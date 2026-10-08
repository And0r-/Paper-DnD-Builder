/**
 * The number of talents comes from the rule core (format 0.6 count by
 * expression): hillfolk get one more. Since format 0.8 the talents of all
 * sources share one step with its own texts, so the step shows the count
 * on its counter; the choice's hillfolk text variant is checked in the unit
 * tests (package-text.test.ts). One language on screen, in German and English.
 */
import type { Page } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { chooseLanguage, expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

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

async function intro(page: Page, id: string, lang: "de" | "en", text: RegExp, name: string) {
  await page.goto(`/c/${id}/step/talents`);
  // The shared list words the count; the step's own texts stand above it.
  await expect(page.locator("[data-pool-total]")).toHaveText(text);
  await expectOneLanguage(page, lang);
  await shot(page, name);
}

test("the talents step counts one more talent for hillfolk", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "variants");
  const hill = await riverRunner(page, "folk.hillfolk");
  const moor = await riverRunner(page, "folk.moorfolk");

  await intro(page, hill, "de", /^Du wählst 3: /, "31-talente-bergvolk");
  await intro(page, moor, "de", /^Du wählst 2: /, "32-talente-moorvolk");

  await page.goto("/settings");
  await chooseLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();

  await intro(page, hill, "en", /^You choose 3: /, "33-talents-hillfolk-en");
  await intro(page, moor, "en", /^You choose 2: /, "34-talents-moorfolk-en");
});
