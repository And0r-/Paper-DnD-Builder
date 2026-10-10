/**
 * The admin (AND-353): the first login with the start password from the
 * README shows a new password once; the menu then has "Verwaltung": the
 * overview with its numbers and charts, and the accounts: one made an
 * admin, one deleted after typing its name. A player sees none of it, and
 * /admin sends them away.
 *
 * The start password works once per server, so the first test needs a
 * fresh one (as `pnpm test:e2e` starts).
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { animationsDone, expect, shot, signup, test } from "./helpers.ts";

const START_PASSWORD = "admin-erster-start-2026";

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

test("the first admin: start password, a new one shown once, then the accounts", async ({
  page,
  foreign,
}) => {
  void foreign;
  // Two players to look after, made through the screens; then out again.
  const suffix = String(Date.now() % 100_000);
  const ada = `Ada ${suffix}`;
  const bo = `Bo ${suffix}`;
  for (const name of [ada, bo]) {
    await signup(page, name);
    await page.request.post("/api/auth/logout");
  }

  await page.goto("/login");
  await page.getByLabel(m["login.whoLabel"]).fill("admin");
  await page.getByLabel(m["login.passwordLabel"]).fill(START_PASSWORD);
  await page.getByRole("button", { name: m["login.submit"], exact: true }).click();

  // The start password is swapped at once: the new one is on the screen, this once.
  await expect(
    page.getByRole("heading", { name: fill(m["password.welcomeBack"], { name: "admin" }) }),
  ).toBeVisible();
  const secret = (await page.locator(".copy-text__value").textContent())!.trim();
  expect(secret).not.toBe(START_PASSWORD);
  await page.getByRole("button", { name: m["password.done"] }).click();
  await expect(page.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
  const again = await page.request.post("/api/auth/login", {
    data: { login: "admin", password: START_PASSWORD },
  });
  expect(again.status()).toBe(401);

  // The menu has "Verwaltung" between the settings and logging out.
  await page.getByRole("button", { name: m["menu.open"] }).click();
  const menu = page.getByRole("dialog", { name: m["menu.title"] });
  expect(
    (await menu.locator(".drawer__box > .drawer__links > li").allInnerTexts()).map((e) => e.trim()),
  ).toEqual([
    m["menu.characters"],
    m["menu.campaigns"],
    m["menu.settings"],
    m["menu.admin"],
    m["menu.logout"],
  ]);
  await menu.getByRole("link", { name: m["menu.admin"] }).click();

  // The overview: tiles with the numbers, two charts with their tables, the server.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: m["admin.overviewTitle"], level: 1 })).toBeVisible();
  const tile = (label: string) =>
    page.locator(".admin-tile").filter({ has: page.getByText(label, { exact: true }) });
  // The admin is active now, at least.
  await expect(tile(m["admin.activeNow"]).locator("dd")).not.toHaveText("0");
  await expect(tile(m["admin.accountsTotal"])).toBeVisible();
  await expect(tile(m["admin.charactersTotal"])).toBeVisible();
  for (const chart of [m["admin.accountsPerWeek"], m["admin.draftsPerWeek"]]) {
    const figure = page.getByRole("figure", { name: chart });
    await expect(figure.getByRole("img", { name: chart })).toBeVisible();
    await expect(figure.getByRole("table").getByRole("row")).toHaveCount(27);
  }
  await expect(page.getByRole("heading", { name: m["admin.server"], level: 2 })).toBeVisible();
  await axe(page);
  await shot(page, "96-admin-overview");

  const tabs = page.getByRole("navigation", { name: m["admin.title"] });
  await expect(tabs.getByRole("link", { name: m["admin.overviewTitle"] })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await tabs.getByRole("link", { name: m["admin.accountsTitle"] }).click();
  await expect(page).toHaveURL(/\/admin\/accounts$/);
  await expect(page.getByRole("heading", { name: m["admin.accountsTitle"], level: 1 })).toBeVisible();

  // Found by a part of the name: both players, newest first.
  await page.getByLabel(m["admin.searchLabel"]).fill(suffix);
  await page.getByRole("button", { name: m["admin.search"], exact: true }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("rowheader")).toHaveText([bo, ada]);
  await axe(page);
  await shot(page, "95-admin-accounts");

  // Ada becomes an admin.
  const label = (action: string, name: string) => fill(m["admin.actionLabel"], { action, name });
  await page.getByRole("button", { name: label(m["admin.makeAdmin"], ada) }).click();
  await expect(page.getByText(fill(m["admin.madeAdmin"], { name: ada }))).toBeVisible();
  const adaRow = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: ada }) });
  await expect(adaRow.getByRole("cell").nth(2)).toHaveText(m["admin.roleAdmin"]);
  await expect(page.getByRole("button", { name: label(m["admin.removeAdmin"], ada) })).toBeVisible();

  // Bo is deleted, once the name is typed; a wrong one is refused.
  await page.getByRole("button", { name: label(m["admin.delete"], bo) }).click();
  const dialog = page.getByRole("dialog", { name: fill(m["admin.deleteTitle"], { name: bo }) });
  const field = dialog.getByLabel(fill(m["admin.deleteTypeLabel"], { name: bo }));
  await field.fill(ada);
  await dialog.getByRole("button", { name: m["admin.delete"], exact: true }).click();
  await expect(dialog.getByText(fill(m["admin.deleteMismatch"], { name: bo }))).toBeVisible();
  await field.fill(bo);
  await dialog.getByRole("button", { name: m["admin.delete"], exact: true }).click();
  await expect(page.getByText(fill(m["admin.deleted"], { name: bo }))).toBeVisible();
  await expect(table.getByRole("rowheader")).toHaveText([ada]);
});

test("a player has no admin entry in the menu, and /admin sends them away", async ({ page, foreign }) => {
  void foreign;
  await signup(page, `Spielerin ${Date.now() % 100_000}`);
  await page.getByRole("button", { name: m["menu.open"] }).click();
  const menu = page.getByRole("dialog", { name: m["menu.title"] });
  await expect(menu.getByRole("link", { name: m["menu.settings"] })).toBeVisible();
  await expect(menu.getByRole("link", { name: m["menu.admin"] })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const path of ["/admin", "/admin/accounts"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/characters$/);
  }
  const res = await page.request.get("/api/admin/accounts");
  expect(res.status()).toBe(403);
});
