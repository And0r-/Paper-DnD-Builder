/**
 * Login without mail (AND-235): get started with a name alone, see the
 * password once, log in on a second device with the password alone (typed
 * the way people type it), manage passwords in the settings. Nothing waits
 * for a mail and nothing is mailed.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { readdir } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { chooseLanguage, expect, expectOneLanguage, login, OUTBOX, shot, test } from "./helpers.ts";

async function secondDevice(browser: Browser, tag: string): Promise<Page> {
  const context = await browser.newContext({
    locale: "de-DE",
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + tag.length) % 250}` },
  });
  return context.newPage();
}

async function noAxeViolations(page: Page) {
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

const mails = async () => (await readdir(OUTBOX).catch(() => [])).length;

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;

  test(`${lang}: get started with a name, the password once, then log in elsewhere with it`, async ({
    page,
    browser,
    foreign,
  }) => {
    void foreign;
    const before = await mails();
    const name = lang === "de" ? "Mira" : "Robin";
    await page.goto("/login");
    if (lang === "en") await chooseLanguage(page, "en");
    await expect(page.getByRole("heading", { level: 1, name: m["login.title"] })).toBeVisible();
    await expect(page.getByText(m["login.emailHelp"])).toBeVisible();
    await expectOneLanguage(page, lang);
    await noAxeViolations(page);
    await shot(page, `21-login-start-${lang}`);

    // A name is needed; the address is not.
    await page.getByRole("button", { name: m["login.start"] }).click();
    await expect(page.getByText(m["login.nameMissing"])).toBeVisible();
    await page.getByLabel(m["login.nameLabel"]).fill(name);
    await page.getByRole("button", { name: m["login.start"] }).click();

    // The password, once, with what to do with it. Nothing moves on by itself.
    const shown = page.getByRole("region", { name: m["password.welcome"].replace("{name}", name) });
    await expect(shown.getByText(m["password.text"])).toBeVisible();
    await expect(shown.getByText(m["password.keep"])).toBeVisible();
    // No address given: this password is the only way back in, and the screen says so.
    await expect(shown.getByText(m["password.noMail"])).toBeVisible();
    // The whole screen fits on the phone, down to the button.
    const done = (await shown.getByRole("button", { name: m["password.done"] }).boundingBox())!;
    expect(done.y + done.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const password = (await shown.locator(".copy-text__value").textContent())!.trim();
    expect(password).toMatch(/^[a-zäöüß]+(?:-[a-zäöüß]+){4}-\d{4}$/);
    // A line breaks only before a hyphen, never after one: no line of the password ends in "-".
    const lines = await shown.locator(".copy-text__value code").evaluate((code) => {
      const range = document.createRange();
      const ends: string[] = [];
      let lastTop = -1;
      let line = "";
      for (const node of [...code.childNodes].flatMap((n) => (n.nodeType === 3 ? [n] : [...n.childNodes]))) {
        for (let i = 0; i < (node.textContent ?? "").length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const top = Math.round(range.getBoundingClientRect().top);
          if (lastTop >= 0 && top > lastTop + 2) {
            ends.push(line);
            line = "";
          }
          lastTop = top;
          line += node.textContent![i];
        }
      }
      return [...ends, line];
    });
    for (const line of lines) expect(line).not.toMatch(/-$/);
    await expectOneLanguage(page, lang);
    await noAxeViolations(page);
    await shot(page, `21-login-password-${lang}`);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/login$/);
    await shown.getByRole("button", { name: m["password.done"] }).click();
    await expect(page.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();
    await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
    await page.waitForURL(/\/c\/[0-9a-f-]+\/level$/);
    expect(await mails()).toBe(before);

    // Another device: the password alone, typed with spaces and a capital, finds the account.
    const other = await secondDevice(browser, `second-${lang}`);
    await other.goto("/login");
    if (lang === "en") await chooseLanguage(other, "en");
    await other.getByRole("button", { name: m["login.havePassword"] }).click();
    await expect(other.getByRole("heading", { level: 1, name: m["login.haveTitle"] })).toBeVisible();
    await other.getByLabel(m["login.passwordLabel"]).fill("x-y-z-v-w-1234");
    await other.getByRole("button", { name: m["login.submit"], exact: true }).click();
    await expect(other.getByText(m["login.wrongPassword"])).toBeVisible();
    await expectOneLanguage(other, lang);
    await shot(other, `21-login-have-${lang}`);
    const typed = password.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    await other.getByLabel(m["login.passwordLabel"]).fill(typed);
    await other.getByRole("button", { name: m["login.submit"], exact: true }).click();
    await expect(other.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();
    await expect(other.getByRole("main").getByRole("listitem")).toHaveCount(1);
    await other.context().close();
  });
}

test("settings: a second password, the first deleted, the last one stays", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  const m = de;
  await page.goto("/login");
  await page.getByLabel(m["login.nameLabel"]).fill("Kim");
  await page.getByRole("button", { name: m["login.start"] }).click();
  const first = (await page.locator(".copy-text__value").textContent())!.trim();
  await page.getByRole("button", { name: m["password.done"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText(m["settings.signedInAs"].replace("{name}", "Kim"))).toBeVisible();
  const section = page.getByRole("region", { name: m["settings.passwords"] });
  await expect(section.getByText(m["settings.passwordsText"])).toBeVisible();
  const list = section.getByRole("list", { name: m["settings.passwordsListLabel"] });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  // The server's own password is named on the screen, in its language, not by a date.
  await expect(list.getByText(m["settings.passwordFirst"])).toBeVisible();
  // The last password cannot go; the note says why.
  await expect(list.getByRole("button", { name: /.+/ })).toBeDisabled();
  await expect(section.getByText(m["settings.passwordLast"])).toBeVisible();

  // A second one, with a name, shown once.
  await section.getByRole("button", { name: m["settings.passwordNew"] }).click();
  const dialog = page.getByRole("dialog", { name: m["settings.passwordNew"] });
  await dialog.getByLabel(m["settings.passwordName"]).fill("Handy");
  await dialog.getByRole("button", { name: m["settings.passwordCreate"] }).click();
  const shown = page.getByRole("dialog", { name: m["password.title"] });
  await expect(shown.getByText(m["password.text"])).toBeVisible();
  const second = (await shown.locator(".copy-text__value").textContent())!.trim();
  expect(second).not.toBe(first);
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "21-login-settings-new-password");
  await shown.getByRole("button", { name: m["password.done"] }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("Handy")).toBeVisible();
  await expect(section.getByText(m["settings.passwordLast"])).toHaveCount(0);

  // Delete the first: it stops working, the second works.
  const firstItem = list.getByRole("listitem").first();
  await firstItem.getByRole("button", { name: m["settings.passwordDelete"] }).click();
  await page
    .getByRole("dialog", { name: m["settings.passwordDeleteTitle"] })
    .getByRole("button", { name: m["settings.passwordDeleteConfirm"] })
    .click();
  await expect(page.getByText(m["settings.passwordDeleted"])).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("button", { name: /.+/ })).toBeDisabled();
  await shot(page, "21-login-settings-passwords");

  const other = await secondDevice(browser, "second-settings");
  expect((await other.request.post("/api/auth/login", { data: { password: first } })).status()).toBe(401);
  await login(other, second);
  await other.context().close();

  // Name and address: the address is optional and can be removed again.
  const identity = page.getByRole("region", { name: m["settings.identity"] });
  await identity.getByLabel(m["settings.nameLabel"]).fill("Kim Nord");
  await identity.getByLabel(m["settings.emailLabel"]).fill("kim@example.test");
  await identity.getByRole("button", { name: m["settings.identitySave"] }).click();
  await expect(page.getByText(m["settings.identitySaved"])).toBeVisible();
  await expect(page.getByText(m["settings.signedInAs"].replace("{name}", "Kim Nord"))).toBeVisible();
  await identity.getByLabel(m["settings.emailLabel"]).fill("");
  await identity.getByRole("button", { name: m["settings.identitySave"] }).click();
  await expect
    .poll(
      async () => ((await (await page.request.get("/api/account")).json()) as { account: object }).account,
    )
    .toMatchObject({ name: "Kim Nord", email: null });
});

test("an account from before: a wrong address or password is refused in plain words", async ({
  page,
  foreign,
}) => {
  void foreign;
  const m = de;
  await page.goto("/login");
  await page.getByRole("button", { name: m["login.havePassword"] }).click();
  await page.getByRole("button", { name: m["login.legacy"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: m["login.legacyTitle"] })).toBeVisible();
  await page.getByLabel(m["login.legacyEmailLabel"]).fill("niemand@example.test");
  await page.getByLabel(m["login.legacyPasswordLabel"]).fill("anker-falke-wiese-7320");
  await page.getByRole("button", { name: m["login.submit"], exact: true }).click();
  await expect(page.getByText(m["login.legacyWrong"])).toBeVisible();
  await expectOneLanguage(page, "de");
  await noAxeViolations(page);
  await shot(page, "21-login-legacy");
  await page.getByRole("button", { name: m["login.toLogin"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: m["login.haveTitle"] })).toBeVisible();
});
