/**
 * Feedback (AND-354): a player opens it from the menu, the one place it is
 * offered; an empty text sends nothing; kind, four stars and a text are
 * sent, the dialog closes with thanks and the focus is back on the menu
 * button. The admin finds it under Verwaltung → Feedback with the player's
 * name and the page, marks it done, and "Offen" no longer shows it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { animationsDone, expect, loginAdmin, shot, signup, test } from "./helpers.ts";

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

test("a player sends feedback from the menu; the admin finds it and marks it done", async ({
  page,
  foreign,
}) => {
  void foreign;
  const name = `Fee ${Date.now() % 100_000}`;
  const words = `Der Knopf unten fehlt.\nSonst schön. ${name}`;
  await signup(page, name);
  const sent: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/feedback") sent.push(req.method());
  });

  // Nothing on the page itself: only the menu offers it, as a button that leaves the page as it is.
  const main = page.getByRole("main");
  await expect(main.getByText(m["menu.feedback"], { exact: true })).toHaveCount(0);
  const menuButton = page.getByRole("button", { name: m["menu.open"] });
  await menuButton.click();
  const menu = page.getByRole("dialog", { name: m["menu.title"] });
  await menu.getByRole("button", { name: m["menu.feedback"], exact: true }).click();
  await expect(menu).toBeHidden();
  const dialog = page.getByRole("dialog", { name: m["feedback.title"] });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/characters$/);
  await expect(dialog.getByText(m["feedback.intro"])).toBeVisible();
  await expect(dialog.getByText(m["feedback.note"])).toBeVisible();
  // "Allgemein" is chosen until another is.
  await expect(dialog.getByRole("radio", { name: m["feedback.kindOther"] })).toBeChecked();
  await axe(page);
  await shot(page, "97-feedback-dialog");

  // An empty text: a word at the field, nothing sent.
  await dialog.getByRole("button", { name: m["feedback.send"] }).click();
  await expect(dialog.getByText(m["feedback.textMissing"])).toBeVisible();
  expect(sent).toEqual([]);

  await dialog.locator(".segmented__label", { hasText: m["feedback.kindWrong"] }).click();
  await expect(dialog.getByRole("radio", { name: m["feedback.kindWrong"] })).toBeChecked();
  const star = (n: number) =>
    dialog.getByRole("button", { name: fill(m["feedback.ratingValue"], { rating: n }) });
  // A second tap on the chosen star takes the rating back; then four.
  await star(2).click();
  await expect(star(2)).toHaveAttribute("aria-pressed", "true");
  await star(2).click();
  await expect(star(2)).toHaveAttribute("aria-pressed", "false");
  await star(4).click();
  await expect(star(4)).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel(m["feedback.text"]).fill(words);
  await dialog.getByRole("button", { name: m["feedback.send"] }).click();

  await expect(page.getByRole("status").filter({ hasText: m["feedback.thanks"] })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
  expect(sent).toEqual(["POST"]);

  // The admin: the overview counts it, the feedback page shows it.
  await page.request.post("/api/auth/logout");
  await loginAdmin(page);
  await page.goto("/admin");
  const tile = page.locator(".admin-tile").filter({ has: page.getByText(m["admin.feedbackOpenTile"]) });
  await expect(tile.locator("dd")).not.toHaveText("0");
  await tile.getByRole("link").click();
  await expect(page).toHaveURL(/\/admin\/feedback$/);
  await expect(page.getByRole("heading", { name: m["admin.feedbackTitle"], level: 1 })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: m["admin.title"] });
  await expect(tabs.getByRole("link", { name: m["admin.feedbackTitle"] })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const card = page.locator(".admin-feedback__item").filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(m["feedback.kindWrong"], { exact: true })).toBeVisible();
  await expect(
    card.getByText(fill(m["admin.feedbackRatingValue"], { rating: 4 }), { exact: true }),
  ).toBeVisible();
  await expect(card.locator("code")).toHaveText("/characters");
  // The text as written, its line break kept.
  expect(await card.locator(".admin-feedback__text").textContent()).toBe(words);
  await axe(page);
  await shot(page, "98-admin-feedback");

  await card.getByRole("button", { name: new RegExp(`^${m["admin.feedbackMarkDone"]}: ${name}, `) }).click();
  await expect(page.getByRole("status").filter({ hasText: m["admin.feedbackMarkedDone"] })).toBeVisible();
  // "Offen" is the filter: done, it is gone from the list.
  await expect(page.getByRole("radio", { name: m["admin.feedbackStatusOpen"] })).toBeChecked();
  await expect(card).toHaveCount(0);
  await page.locator(".segmented__label", { hasText: m["admin.feedbackStatusDone"] }).click();
  await expect(card).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: new RegExp(`^${m["admin.feedbackReopen"]}: `) }),
  ).toBeVisible();
});

test("a player has no feedback page to open, and reads none", async ({ page, foreign }) => {
  void foreign;
  await signup(page, `Gast ${Date.now() % 100_000}`);
  await page.goto("/admin/feedback");
  await expect(page.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
  expect((await page.request.get("/api/admin/feedback")).status()).toBe(403);
});
