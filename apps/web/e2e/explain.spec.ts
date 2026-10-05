/**
 * Numbers never change without a reason (AND-32): a choice asked at a
 * gather point counts as its own step, a score shows what adds to it, a
 * gift shows the number on the sheet, and things nobody picked say where
 * they come from. In German and in English.
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, makeCharacter, shot, test, uniqueEmail } from "./helpers.ts";

/** A level-3 draft with only these answers, made through the API. */
async function draftWith(page: Page, answers: [string, unknown][]): Promise<string> {
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await req.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  for (const [choice, answer] of answers) {
    const r = await req.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }
  return id;
}

type Lang = "de" | "en";

/**
 * The value boxes on the overview sit two side by side on a phone: no text
 * runs out of them (AND-45), not even a word far longer than any in the
 * demo package.
 */
async function expectNothingSpills(page: Page, lang: Lang) {
  const spills = () =>
    page
      .locator(".value")
      .evaluateAll((boxes) =>
        boxes.flatMap((box) =>
          [box, ...box.querySelectorAll("*")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => `${el.className}: ${el.textContent}`),
        ),
      );
  expect(await spills()).toEqual([]);
  await page
    .locator(".value__from")
    .first()
    .evaluate((el) => {
      el.dataset["was"] = el.textContent ?? "";
      el.textContent = "16 aus Nebelfährmannslaternenträgerinnenzunftabzeichen";
    });
  expect(await spills()).toEqual([]);
  await shot(page, `52-ueberblick-langes-wort-${lang}`);
  await page
    .locator(".value__from")
    .first()
    .evaluate((el) => {
      el.textContent = el.dataset["was"] ?? "";
    });
}

const WORDS = {
  de: {
    score: /Geschick: 7 \+ 1 aus Kindheit Fährkind = 8/,
    origin: "Aus Herkunft Moorvolk",
    onSheet: /^Auf deinem Bogen: 21 = 3 aus .+ \+ 18 aus Beruf Laternenträgerin$/,
    later: "Diese Zahl ändert sich noch. Sie hängt auch von deiner Wahl im Schritt Grundwerte ab.",
    progress: /^Schritt \d+ von \d+ · Ausrüstung$/,
  },
  en: {
    score: /Grace: 7 \+ 1 from Ferry Child \(Upbringing\) = 8/,
    origin: "From Moorfolk (Folk)",
    onSheet: /^On your sheet: 21 = 3 from .+ \+ 18 from Lantern Bearer \(Calling\)$/,
    later: "This number still changes. It also depends on what you choose in the step Scores.",
    progress: /^Step \d+ of \d+ · Gear$/,
  },
} as const;

async function checkAll(page: Page, id: string, early: string, lang: Lang) {
  const m = lang === "de" ? de : en;
  const w = WORDS[lang];

  // A choice the calling brought, asked at its gather point far later: a step of its own,
  // never a part of whatever step comes before it.
  await page.goto(`/c/${id}/step/gear`);
  await expect(page.locator(".progress__text")).toHaveText(w.progress);
  await expectOneLanguage(page, lang);
  await shot(page, `50-gesammelt-eigener-schritt-${lang}`);

  // A gift before the scores are chosen: it says the number still changes.
  await page.goto(`/c/${early}/step/calling-gifts`);
  await expect(page.getByText(w.later)).toBeVisible();
  await expectOneLanguage(page, lang);
  await shot(page, `51-geschenke-vorher-${lang}`);

  // A gift: the number that ends up on the sheet, with what adds to it.
  await page.goto(`/c/${id}/step/calling-gifts`);
  await expect(page.getByText(w.onSheet)).toBeVisible();
  await expectOneLanguage(page, lang);
  await shot(page, `51-geschenke-${lang}`);

  // Overview: scores as sums, numbers with their origin, unpicked things with theirs.
  await page.goto(`/c/${id}/overview`);
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  await expect(page.getByText(w.score)).toBeVisible();
  await expect(page.getByRole("heading", { name: m["origins.title"] })).toBeVisible();
  await expect(page.getByText(w.origin, { exact: true })).toBeVisible();
  await expectNothingSpills(page, lang);
  await expectOneLanguage(page, lang);
  await shot(page, `52-ueberblick-${lang}`);

  // The end: the same origins, so nothing on the printout is a surprise.
  await page.goto(`/c/${id}/done`);
  await expect(page.getByRole("heading", { name: m["origins.title"] })).toBeVisible();
  await expect(page.getByText(w.origin, { exact: true })).toBeVisible();
  await expectOneLanguage(page, lang);
  await shot(page, `53-fertig-${lang}`);
}

test("numbers and things say where they come from, in both languages", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("explain"));
  const id = await makeCharacter(page);
  // More might, so the scores add to the calling's stamina too.
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const r = await page.request.put(`/api/drafts/${id}/answers/scores`, {
    data: {
      version: view.draft.version,
      answer: { method: 0, assign: { mightBase: 11, graceBase: 7, witBase: 9, heartBase: 8 } },
    },
  });
  expect(r.status()).toBe(200);
  const early = await draftWith(page, [
    ["folk", { pick: "folk.moorfolk" }],
    ["upbringing", { pick: "upbringing.ferry-child" }],
    ["calling", { pick: "calling.lantern-bearer" }],
  ]);
  await checkAll(page, id, early, "de");

  await page.goto("/settings");
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();
  await checkAll(page, id, early, "en");
});
