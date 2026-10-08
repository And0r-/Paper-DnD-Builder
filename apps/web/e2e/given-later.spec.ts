/**
 * A pick that a later step grants anyway (AND-162): the coastfolk's flair is
 * asked right after the folk, and the bell tower upbringing grants the flair
 * "listening". Picked first and then granted, the earlier step turns red,
 * says where the flair comes from and asks again without it.
 */
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, shot, signup, test } from "./helpers.ts";

const DESKTOP = { isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

async function newDraft(page: Page): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  const view = (await created.json()) as { draft: { id: string; version: number } };
  const res = await page.request.patch(`/api/drafts/${view.draft.id}`, {
    data: { version: view.draft.version, level: 1 },
  });
  expect(res.status()).toBe(200);
  return view.draft.id;
}

/** Picks an option of the current step and waits until the answer is stored. */
async function pick(page: Page, name: string) {
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/answers/"));
  await page.getByRole("main").getByText(name, { exact: true }).click();
  const confirm = page.getByRole("button", { name: m["change.confirm"] });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  expect((await saved).ok()).toBe(true);
}

test.use({ ...DESKTOP, viewport: { width: 1366, height: 900 } });

test("a flair the upbringing grants later is asked again on the folk's step", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "given-later");
  const id = await newDraft(page);

  await page.goto(`/c/${id}/step/folk`);
  await pick(page, "Küstenvolk");
  await page.goto(`/c/${id}/step/coastfolk-flair`);
  await pick(page, "Feines Gehör");
  await page.goto(`/c/${id}/step/upbringing`);
  await pick(page, "Glockenturm");

  // The folk's step is red in the step list and leads to the flair.
  const list = page.getByRole("navigation", { name: m["flow.steps"] });
  const folkStep = list.getByRole("link", { name: /^Herkunft/ });
  await expect(folkStep).toHaveClass(/steplist__link--needsAttention/);

  // On the step: where the flair comes from, and only the other flair to pick.
  await folkStep.click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/step/coastfolk-flair`));
  const note = page.locator("[data-given-by='flair.listening']");
  await expect(note).toHaveText(
    "Das bekommst du schon an anderer Stelle: Feines Gehör (von Glockenturm). Wähle bitte etwas anderes.",
  );
  const options = page.getByRole("main").getByRole("radio");
  await expect(options).toHaveCount(1);
  await expect(page.getByRole("main").getByText("Gewiefte Händlerin", { exact: true })).toBeVisible();
  await shot(page, "162-doppel-rot");

  await pick(page, "Gewiefte Händlerin");
  await expect(note).toHaveCount(0);
  // Open, the section shows its parts: the flair is no longer red.
  await expect(list.getByRole("link", { name: /Eine Stärke von der Küste/ })).not.toHaveClass(
    /steplist__link--needsAttention/,
  );
  await expect(list.locator(".steplist__link--needsAttention")).toHaveCount(0);
});
