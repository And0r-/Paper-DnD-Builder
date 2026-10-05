/**
 * A slow connection: the answer is on screen at once, the server takes its
 * time. Next pressed while the top bar still says "Saving …" is not lost:
 * the button waits where it is, says so, and goes on by itself once the
 * answer is saved and the next step is there. One tap is enough; more taps
 * change nothing.
 */
import type { Page, Route } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, shot, test, uniqueEmail } from "./helpers.ts";

const SAVE_MS = 4000;
const PAGE_MS = 4000;

/** A level-3 lantern bearer whose scores are still open. */
async function openScores(page: Page): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await page.request.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  await page.request.put(`/api/drafts/${id}/answers/calling`, {
    data: { version: view.draft.version, answer: { pick: "calling.lantern-bearer" } },
  });
  return id;
}

/** Saving an answer and loading the next step both take a while; counts the saves. */
async function slowServer(page: Page): Promise<{ saves: number }> {
  const seen = { saves: 0 };
  await page.route("**/api/drafts/*/**", async (route: Route) => {
    if (route.request().method() === "PUT") {
      seen.saves++;
      await new Promise((r) => setTimeout(r, SAVE_MS));
    }
    await route.fallback();
  });
  await page.route(/\/step\/[^/?]+\?_rsc=/, async (route: Route) => {
    await new Promise((r) => setTimeout(r, PAGE_MS));
    await route.fallback();
  });
  return seen;
}

test("phone: Next pressed while saving goes on once saved, one tap is enough", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("slow-save"));
  const id = await openScores(page);
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Worin ist dein Charakter stark?" }),
  ).toBeFocused();
  const seen = await slowServer(page);

  await page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.getByText("Noch 2 Punkte übrig")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText(m["save.saving"]);

  // One tap while saving: the button waits visibly, the step stays until saved.
  const next = page.locator(".step-footer__bar").getByRole("button");
  await next.click();
  await expect(next).toHaveText(m["save.saving"]);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(page).toHaveURL(`/c/${id}/step/scores`);
  await shot(page, "75-weiter-waehrend-speichert");
  // A second tap changes nothing (force: the button takes taps while it waits).
  await next.click({ force: true });

  // Saved: the next step is on its way, the button still says so.
  await expect(page.locator(".save-status")).toHaveText(m["save.saved"], { timeout: SAVE_MS * 2 });
  await expect(next).toHaveText(m["flow.going"]);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await shot(page, "76-weiter-naechster-schritt-laedt");

  // And there it is, by itself: the step right after, not one further.
  await expect(page).toHaveURL(`/c/${id}/step/talents`, { timeout: PAGE_MS * 4 });
  await expect(page.locator(".step-footer__bar").getByRole("button")).toHaveText(m["common.next"]);
  expect(seen.saves).toBe(1);
  await page.unroute("**/api/drafts/*/**");
  await page.unroute(/\/step\/[^/?]+\?_rsc=/);
  await page.goto(`/c/${id}/step/scores`);
  await expect(page.getByText("Noch 2 Punkte übrig")).toBeVisible();
});

test("phone: Back while Next waits for saving: Back wins, nothing is lost", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("slow-save-back"));
  const id = await openScores(page);
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Worin ist dein Charakter stark?" }),
  ).toBeFocused();
  await slowServer(page);

  await page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.locator(".save-status")).toHaveText(m["save.saving"]);
  await page.locator(".step-footer__bar").getByRole("button").click();
  await page.locator(".step-footer__bar").getByRole("link", { name: m["common.back"] }).click();
  await expect(page).not.toHaveURL(/\/step\/scores$/);
  const back = page.url();

  // Saved after all, and the earlier tap on Next does not pull the player along.
  await expect(page.locator(".save-status")).toHaveText(m["save.saved"], { timeout: SAVE_MS * 2 });
  await page.waitForTimeout(PAGE_MS);
  await expect(page).toHaveURL(back);
});
