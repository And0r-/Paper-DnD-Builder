/**
 * The score steps say what each number does (AND-78): every row shows the
 * bonus its score gives and a sentence for this calling, the scores that
 * matter most carry the package's badge, the point rule stands above the
 * rows in one sentence. The upbringing's gift that follows says why it
 * comes after the scores and reads as a sum per row ("9 from Scores + 2 =
 * 11"). The overview sums each score up once and names every part.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { join } from "node:path";
import { chooseLanguage, expect, login, shot, SHOTS, test, uniqueEmail } from "./helpers.ts";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
}

/** A level-3 lantern bearer from the bell tower; answers up to (not including) the scores. */
async function bellTowerDraft(page: Page, more: [string, unknown][] = []): Promise<string> {
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  view = await (
    await req.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } })
  ).json();
  const answers: [string, unknown][] = [
    ["folk", { pick: "folk.moorfolk" }],
    ["upbringing", { pick: "upbringing.bell-tower" }],
    ["calling", { pick: "calling.lantern-bearer" }],
    ...more,
  ];
  for (const [choice, answer] of answers) {
    const r = await req.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }
  return id;
}

const row = (page: Page, name: string) => page.locator(".pointbuy__row", { hasText: name });

test("scores: each row says what its number does for this calling", async ({ page }) => {
  await login(page, uniqueEmail("scores"));
  const id = await bellTowerDraft(page);
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Worin ist dein Charakter stark?" }),
  ).toBeFocused();

  // The points left in large numbers, the rule in one sentence from the costs.
  await expect(page.locator(".pointbuy__count")).toHaveText("14");
  await expect(page.locator(".pointbuy__rule")).toHaveText(
    "Jedes + kostet 1 Punkt, ab 11 kostet es 2 Punkte.",
  );

  // The scores a lantern bearer needs carry the package's badge; the others do not.
  await expect(row(page, "Herz").locator(".badge")).toHaveText("Wichtig als Laternenträgerin");
  await expect(row(page, "Klugheit").locator(".badge")).toHaveText("Wichtig als Laternenträgerin");
  await expect(row(page, "Kraft").locator(".badge")).toHaveCount(0);

  // What the number gives, and a sentence for this calling.
  await expect(row(page, "Herz").locator(".pointbuy__effect")).toHaveText("Herz-Bonus +0");
  await expect(row(page, "Herz").locator(".pointbuy__explain")).toContainText("Dein wichtigster Wert.");
  // Tapping + changes what the row gives at once.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Herz erhöhen" }).click();
  await expect(row(page, "Herz").locator(".stepper__value")).toHaveText("9");
  await expect(row(page, "Herz").locator(".pointbuy__effect")).toHaveText("Herz-Bonus +1");
  await expect(page.locator(".pointbuy__count")).toHaveText("11");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "nachher-1-grundwerte");
  await axe(page);
});

test("the upbringing's gift comes after the scores and reads as a sum", async ({ page }) => {
  await login(page, uniqueEmail("gifts"));
  const id = await bellTowerDraft(page, [
    ["scores", { method: 0, assign: { mightBase: 8, graceBase: 7, witBase: 9, heartBase: 11 } }],
  ]);
  await page.goto(`/c/${id}/step/bell-tower-gifts`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Was hat dir der Glockenturm mitgegeben?" }),
  ).toBeFocused();
  await expect(page.locator(".question__intro")).toContainText(
    "Deine Grundwerte stehen fest. Deine Kindheit im Glockenturm gibt dir noch +2 und +1 dazu.",
  );

  const gift = (name: string) => page.locator(".array-assign__row", { hasText: name });
  // Before a tap: the score as it is, plus 0.
  await expect(gift("Herz").locator(".array-assign__sum")).toHaveText("11 aus Grundwerte + 0 = 11");
  await expect(gift("Herz").locator(".array-assign__effect")).toHaveText("Herz-Bonus +1");
  await gift("Herz").click();
  await expect(gift("Herz").locator(".array-assign__sum")).toContainText("11 aus Grundwerte + 2 = 13");
  await gift("Klugheit").click();
  // All handed out: saved, and the bonus follows the new score.
  await expect(gift("Herz").locator(".array-assign__sum")).toHaveText("11 aus Grundwerte + 2 = 13");
  await expect(gift("Herz").locator(".array-assign__effect")).toHaveText("Herz-Bonus +2");
  await expect(gift("Klugheit").locator(".array-assign__sum")).toHaveText("9 aus Grundwerte + 1 = 10");
  await expect(gift("Klugheit").locator(".array-assign__effect")).toHaveText("Klugheit-Bonus +1");
  await expect(gift("Kraft").locator(".array-assign__sum")).toHaveText("8 aus Grundwerte + 0 = 8");
  await expect(gift("Kraft").locator(".array-assign__effect")).toHaveText("Kraft-Bonus +0");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "nachher-2-gabe");
  await axe(page);
});

test("overview: each score summed up once, every part named", async ({ page }) => {
  await login(page, uniqueEmail("scores-overview"));
  const id = await bellTowerDraft(page, [
    ["talents-lantern-bearer", { picks: ["talent.mending", "talent.climbing"] }],
    ["gear", { pick: "item.reed-shield" }],
    ["knacks-lantern", { picks: ["knack.warm-glow", "knack.glow-thread", "knack.quiet-word"] }],
    ["path", { pick: "path.lightwarden" }],
    ["scores", { method: 0, assign: { mightBase: 8, graceBase: 7, witBase: 9, heartBase: 11 } }],
    ["bell-tower-gifts", { method: 0, assign: { heartGift: 2, witGift: 1, mightGift: 0 } }],
    ["extra-talent", { pick: "talent.weather-sense" }],
    ["name", { text: "Mira" }],
    ["age", { value: 20 }],
  ]);
  await page.goto(`/c/${id}/overview`);
  const item = (title: string) =>
    page.locator(".summary__item", { has: page.getByRole("heading", { name: title }) });
  await expect(item("Grundwerte")).toContainText("Herz: 11 aus Grundwerte + 2 aus Kindheit Glockenturm = 13");
  // The gift step only says what it added, and from where; no second sum.
  await expect(item("Gabe der Kindheit").locator(".summary__line")).toHaveText([
    "Klugheit + 1 aus Kindheit Glockenturm",
    "Herz + 2 aus Kindheit Glockenturm",
  ]);
  await expect(page.getByText("= 13")).toHaveCount(1);
  await item("Grundwerte").scrollIntoViewIfNeeded();
  await shot(page, "nachher-3-ueberblick");
  // The score steps alone, for the pull request (the bar on top unpinned, so it covers nothing).
  await page.addStyleTag({ content: ".topbar { position: static !important; }" });
  await page.locator(".summary").screenshot({ path: join(SHOTS, "nachher-3-ueberblick-ausschnitt.png") });
});

test("in English the same rows, only English", async ({ page }) => {
  await login(page, uniqueEmail("scores-en"));
  const id = await bellTowerDraft(page);
  await page.goto("/settings");
  await chooseLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.goto(`/c/${id}/step/scores`);
  await expect(
    page.getByRole("heading", { level: 1, name: "What is your character good at?" }),
  ).toBeVisible();
  await expect(page.locator(".pointbuy__rule")).toHaveText(
    "Each + costs 1 point, from 11 on it costs 2 points.",
  );
  await expect(row(page, "Heart").locator(".badge")).toHaveText("Key for a Lantern Bearer");
  await expect(row(page, "Heart").locator(".pointbuy__effect")).toHaveText("Heart bonus +0");
  await expect(page.locator(".pointbuy__count")).toHaveText("14");
  await expect(page.locator(".pointbuy")).not.toContainText("Punkt");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "nachher-4-grundwerte-en");
});
