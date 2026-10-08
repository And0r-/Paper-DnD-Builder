/**
 * The language switch in the top bar of every screen (AND-153): offers the
 * languages of the installed packages, switches the whole screen at once
 * without losing the open step, stores the choice like the settings do and
 * leaves the units alone.
 *
 * The first test only reads what the server lists, so it also runs against
 * another package (E2E_PACKAGES_DIR); the others build with the demo package.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import pde from "../../../packages/demo-package/texts/de/core.json" with { type: "json" };
import pen from "../../../packages/demo-package/texts/en/core.json" with { type: "json" };
import { animationsDone, expect, expectOneLanguage, makeCharacter, shot, signup, test } from "./helpers.ts";

const NAMES: Record<string, string> = { de: "Deutsch", en: "English" };

/** The switch in the top bar, named in the screen language. */
const menu = (page: Page, lang: "de" | "en") =>
  page.getByRole("banner").getByRole("combobox", { name: (lang === "de" ? de : en)["language.label"] });

async function storedAccount(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/account");
    return ((await r.json()) as { account: { language: string; units: Record<string, string> } }).account;
  });
}

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

/** No sideways scrolling: the top bar fits the screen. */
async function expectFits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("before login: the switch offers the packages' languages, each named in itself", async ({
  page,
  foreign,
}) => {
  void foreign;
  const listed = (await (await page.request.get("/api/packages")).json()) as {
    packages: { languages: string[] }[];
  };
  const expected = Object.keys(NAMES).filter((l) => listed.packages.every((p) => p.languages.includes(l)));

  await page.goto("/login");
  const select = menu(page, "de");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("de");
  const options = select.locator("option");
  await expect(options).toHaveText(expected.map((l) => NAMES[l]!));
  for (const l of expected) await expect(select.locator(`option[value="${l}"]`)).toHaveAttribute("lang", l);
  await axe(page);
  await expectFits(page);

  // Keyboard: focus the switch and pick the next language with an arrow key.
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { level: 2, name: en["login.registerTitle"] })).toBeVisible();
  await expect(menu(page, "en")).toBeFocused();
  await expectOneLanguage(page, "en");

  // Kept in the browser for the next visit.
  await page.reload();
  await expect(menu(page, "en")).toHaveValue("en");
  await expectOneLanguage(page, "en");

  // The privacy page has the switch, too.
  await page.goto("/privacy");
  await menu(page, "en").selectOption("de");
  await expect(page.getByRole("heading", { level: 1, name: de["privacy.title"] })).toBeVisible();
  await expectOneLanguage(page, "de");
});

test("logged in: the top bar of every screen switches, stored with the account, units untouched", async ({
  page,
  foreign,
}) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "builds a demo character");
  await signup(page, "lang-menu");
  const id = await makeCharacter(page);
  const before = await storedAccount(page);

  // Every kind of logged-in screen has it, in German and in English.
  const screens: [string, string, string][] = [
    ["/characters", de["characters.title"], en["characters.title"]],
    ["/campaigns", de["campaigns.title"], en["campaigns.title"]],
    ["/settings", de["settings.title"], en["settings.title"]],
    [`/c/${id}/level`, de["level.question"], en["level.question"]],
    [`/c/${id}/step/folk`, pde.entries["choice.folk.question"], pen.entries["choice.folk.question"]],
    [`/c/${id}/overview`, de["overview.question"], en["overview.question"]],
    [`/c/${id}/done`, de["done.title"], en["done.title"]],
  ];
  const heading = (text: string) =>
    text.includes("{")
      ? new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+"))
      : text;
  for (const [url, deTitle, enTitle] of screens) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: heading(deTitle) })).toBeVisible();
    // A language change sends only the language: units the reader never chose stay unchosen.
    const sent = page.waitForRequest(
      (r) => r.url().endsWith("/api/account/settings") && r.method() === "PATCH",
    );
    await menu(page, "de").selectOption("en");
    expect((await sent).postDataJSON()).toEqual({ language: "en" });
    await expect(page.getByRole("heading", { level: 1, name: heading(enTitle) })).toBeVisible();
    await expectOneLanguage(page, "en");
    await expectFits(page);
    if (url === "/characters") await shot(page, "50-sprachwahl-en");
    await menu(page, "en").selectOption("de");
    await expect(page.getByRole("heading", { level: 1, name: heading(deTitle) })).toBeVisible();
    await expectOneLanguage(page, "de");
    if (url === "/characters") await shot(page, "50-sprachwahl-de");
  }

  // Stored with the account, units as they were.
  await menu(page, "de").selectOption("en");
  await expect(menu(page, "en")).toHaveValue("en");
  const after = await storedAccount(page);
  expect(after.language).toBe("en");
  expect(after.units).toEqual(before.units);
  await page.reload();
  await expect(menu(page, "en")).toHaveValue("en");
  await expectOneLanguage(page, "en");

  // The settings show the same value.
  await page.goto("/settings");
  await expect(page.getByRole("main").getByRole("radio", { name: "English" })).toBeChecked();
});

test("switching in the middle of a step keeps the step, the choices and what is being typed", async ({
  page,
  foreign,
}) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "builds a demo character");
  await signup(page, "lang-keep");
  const id = await makeCharacter(page, false);

  await page.goto(`/c/${id}/step/character`);
  const name = page.getByLabel(pde.entries["choice.name.question"]);
  await expect(name).toHaveValue("Mira");
  await name.fill("Lio Nebelfahrt");
  const url = page.url();

  await menu(page, "de").selectOption("en");
  await expect(
    page.getByRole("heading", { level: 1, name: pen.entries["step.character.question"] }),
  ).toBeVisible();
  expect(page.url()).toBe(url);
  // The very same field, still holding what was typed: the screen was not loaded again.
  await expect(page.getByLabel(pen.entries["choice.name.question"])).toHaveValue("Lio Nebelfahrt");
  await expectOneLanguage(page, "en");
  await shot(page, "51-sprachwahl-schritt-en");

  // Earlier choices are still there, now in English.
  await page.goto(`/c/${id}/step/folk`);
  await expect(page.locator("[data-option='folk.moorfolk'] input")).toBeChecked();
  await expectOneLanguage(page, "en");
});

test("fits a small phone", async ({ page, foreign }) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "builds a demo character");
  await page.setViewportSize({ width: 320, height: 640 });
  await signup(page, "lang-small");
  const id = await makeCharacter(page);
  for (const url of ["/characters", `/c/${id}/step/folk`, `/c/${id}/overview`]) {
    await page.goto(url);
    await expect(menu(page, "de")).toBeVisible();
    await expectFits(page);
  }
  await shot(page, "52-sprachwahl-schmal");
});
