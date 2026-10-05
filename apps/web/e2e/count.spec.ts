/**
 * An honest step count (AND-77): "Step x of y" and "Part x of y" stand from
 * the first screen on. Going through the build with "choose for me" the
 * total never changes; a pick that brings more steps says so on the screen,
 * in the same moment. The bar moves on every screen, the parts of a long
 * step too.
 */
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

type Messages = typeof de;

interface Screen {
  text: string;
  current: number;
  total: number;
  part: number;
  parts: number;
  bar: number;
  /** The note about added or removed steps, if one shows. */
  note: string;
}

async function newDraft(page: Page, level: number): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  const view = (await created.json()) as { draft: { id: string; version: number } };
  const res = await page.request.patch(`/api/drafts/${view.draft.id}`, {
    data: { version: view.draft.version, level },
  });
  expect(res.status()).toBe(200);
  return view.draft.id;
}

async function read(page: Page, m: Messages): Promise<Screen> {
  const text = (await page.locator(".progress__text").innerText()).replace(/\s+/g, " ").trim();
  const step = new RegExp(
    m["flow.progress"].replace("{current}", "(\\d+)").replace("{total}", "(\\d+)"),
  ).exec(text)!;
  const part = new RegExp(m["flow.part"].replace("{part}", "(\\d+)").replace("{parts}", "(\\d+)")).exec(text);
  const bar = await page
    .locator(".progress__fill")
    .evaluate((el) => parseFloat((el as HTMLElement).style.width));
  const note = (await page.locator(".step-notice").allInnerTexts()).join(" ");
  return {
    text,
    current: Number(step[1]),
    total: Number(step[2]),
    part: part ? Number(part[1]) : 1,
    parts: part ? Number(part[2]) : 1,
    bar,
    note,
  };
}

/**
 * Goes through every screen to the overview: "choose for me" where a step is
 * open (or the pick given for that question), then Next. Returns each
 * screen as it was before and after the answer.
 */
async function walk(
  page: Page,
  m: Messages,
  picks: Record<string, string> = {},
  onScreen?: (s: Screen, i: number) => Promise<void>,
): Promise<{ before: Screen; after: Screen }[]> {
  const out: { before: Screen; after: Screen }[] = [];
  for (let i = 0; i < 80; i++) {
    const h1 = page.getByRole("heading", { level: 1 }).first();
    await expect(h1).toBeVisible();
    const question = (await h1.innerText()).trim();
    if (question === m["overview.question"]) break;
    const before = await read(page, m);
    const own = picks[question];
    const choose = page.locator(".shortcuts").getByRole("button", { name: m["flow.chooseForMe"] });
    if (own) await page.getByRole("main").getByText(own, { exact: true }).click();
    else if (await choose.isVisible()) await choose.click();
    // The answer is shown at once; give the count a moment to follow it.
    await page.waitForTimeout(100);
    const after = await read(page, m);
    out.push({ before, after });
    await onScreen?.(after, i);
    const info = page.getByRole("button", { name: m["info.continue"] });
    const url = page.url();
    if (await info.isVisible()) await info.click();
    else await page.getByRole("button", { name: m["common.next"], exact: true }).click();
    await page.waitForURL((u) => u.toString() !== url);
  }
  return out;
}

/** The total and the parts never change without a note on the same screen (up or down, AND-90); the bar never goes back. */
function expectHonest(screens: { before: Screen; after: Screen }[]) {
  let last: Screen | undefined;
  for (const { before, after } of screens) {
    if (last) {
      // Moving on never changes the count: only an answer can.
      expect(before.total, `${last.text} → ${before.text}`).toBe(last.total);
      expect(before.bar, `${last.text} → ${before.text}`).toBeGreaterThan(last.bar);
      if (before.current === last.current) expect(before.parts).toBe(last.parts);
    }
    if (after.total !== before.total || after.parts !== before.parts)
      expect(after.note, `${before.text} → ${after.text} without a note`).not.toBe("");
    last = after;
  }
}

for (const level of [1, 5, 20]) {
  test(`level ${level}: the count stands from the first screen on`, async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail(`count-${level}`));
    const id = await newDraft(page, level);
    await page.goto(`/c/${id}/step/character`);
    const screens = await walk(page, de, {}, async (s, i) => {
      if (level === 20 && s.parts === 10 && s.part <= 2) {
        await expectOneLanguage(page, "de");
        await shot(page, `count-20-teil-${s.part}-von-${s.parts}-${i}`);
      }
    });
    expectHonest(screens);
    // With the suggestions the total is the same on every screen, without a single note.
    expect(new Set(screens.map((s) => s.after.total)).size).toBe(1);
    expect(screens.filter((s) => s.after.note !== "").map((s) => s.after.text)).toEqual([]);
    if (level === 20) {
      // The boons with their raises: the parts known from the first one on.
      const parts = screens.filter((s) => s.before.parts === 10).map((s) => s.before.part);
      expect(parts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });
}

test("a pick that brings a step says so, and the total holds from then on", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("count-more"));
  const id = await newDraft(page, 1);
  await page.goto(`/c/${id}/step/character`);
  const first = await read(page, de);
  await shot(page, "count-01-erster-schritt");
  const screens = await walk(
    page,
    de,
    { "Womit verdient dein Charakter sein Brot?": "Flussläufer" },
    async (s) => {
      if (s.note !== "") await shot(page, "count-02-hinweis-mehr-schritte");
    },
  );
  expectHonest(screens);
  const grew = screens.find((s) => s.after.total > s.before.total)!;
  expect(grew.after.total).toBe(first.total + 1);
  expect(grew.after.note).toContain("Deine Wahl bringt einen Schritt dazu.");
});

test("in English: the same count and the same note", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("count-en"), "en");
  const id = await newDraft(page, 1);
  await page.goto(`/c/${id}/step/character`);
  const screens = await walk(page, en, { "How does your character earn a living?": "River Runner" });
  expectHonest(screens);
  const grew = screens.find((s) => s.after.total > s.before.total)!;
  expect(grew.after.note).toContain("Your choice adds a step.");
  await expectOneLanguage(page, "en");
});

test("a pick that takes a part away says so, and the parts hold from then on (AND-90)", async ({
  page,
  foreign,
}) => {
  void foreign;
  await login(page, uniqueEmail("count-fewer-parts"));
  const id = await newDraft(page, 20);
  await page.goto(`/c/${id}/step/character`);
  // A boon without a raise of its own: the boons lose one part.
  const screens = await walk(
    page,
    de,
    { "Welche Gabe bekommst du auf Stufe 16?": "Sicherer Schritt" },
    async (s) => {
      if (s.note !== "" && s.parts === 9) await shot(page, "count-90-ein-teil-weniger");
    },
  );
  expectHonest(screens);
  const fell = screens.find((s) => s.after.parts < s.before.parts)!;
  expect(fell.before.text).toContain("Teil 7 von 10");
  expect(fell.after.text).toContain("Teil 7 von 9");
  expect(fell.after.note).toContain(de["flow.partsRemoved.one"]);
  // From there on every part of the boons counts to 9.
  const later = screens
    .slice(screens.indexOf(fell) + 1)
    .filter((s) => s.before.current === fell.after.current);
  expect(later.map((s) => `${s.before.part}/${s.before.parts}`)).toEqual(["8/9", "9/9"]);
});
