/**
 * Lost password (AND-236): an account with an address asks for a link on
 * the login screen, the mail (read from the outbox) holds a link and no
 * password, the link shows a new password and logs in, the new password
 * works on another device, and the link works only once. The settings
 * send the same link as a test.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, mailTo, shot, signup, test, uniqueEmail } from "./helpers.ts";

const m = de;

async function otherDevice(browser: Browser, n: number): Promise<Page> {
  const context = await browser.newContext({
    locale: "de-DE",
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + n) % 250}` },
  });
  return context.newPage();
}

test("lost password: a link by mail shows a new password, once", async ({ page, browser, foreign }) => {
  void foreign;
  const email = uniqueEmail("reset");
  const first = await signup(page, "Kim", "de", email);

  // A device with no session: "Lost your password?" under the password field.
  const lost = await otherDevice(browser, 1);
  await lost.goto("/login");
  await lost.getByRole("button", { name: m["login.havePassword"] }).click();
  await lost.getByRole("button", { name: m["login.lost"] }).click();
  await expect(lost.getByRole("heading", { level: 1, name: m["login.lostTitle"] })).toBeVisible();
  await expect(lost.getByText(m["login.lostNoMail"])).toBeVisible();
  await lost.getByLabel(m["login.lostEmailLabel"]).fill(email);
  await lost.getByRole("button", { name: m["login.lostSend"] }).click();
  await expect(lost.getByRole("heading", { level: 1, name: m["login.sentTitle"] })).toBeVisible();
  await expect(lost.getByText(m["login.sent"])).toBeVisible();
  // Sending again waits a moment.
  await expect(lost.getByRole("button", { name: /\(\D*\d+ s\)/ })).toHaveAttribute("aria-disabled", "true");
  await expectOneLanguage(lost, "de");
  await shot(lost, `22-reset-sent-de`);

  // The mail: a link with the account's name, no password.
  const mail = await mailTo(email);
  expect(mail).not.toContain(first);
  expect(mail).not.toMatch(/[a-zäöüß]+(?:-[a-zäöüß]+){4}-\d{4}/);
  const link = /^Kim: (http\S+\/login\/reset\/[\w-]{43})$/m.exec(mail)?.[1];
  expect(link).toBeTruthy();
  const path = new URL(link!).pathname;

  // The link shows a new password and logs in.
  await lost.goto(path);
  const shown = lost.getByRole("region", { name: m["password.welcomeBack"].replace("{name}", "Kim") });
  const fresh = (await shown.locator(".copy-text__value").textContent())!.trim();
  expect(fresh).toMatch(/^[a-zäöüß]+(?:-[a-zäöüß]+){4}-\d{4}$/);
  expect(fresh).not.toBe(first);
  await expectOneLanguage(lost, "de");
  await shot(lost, `22-reset-password-de`);
  await shown.getByRole("button", { name: m["password.done"] }).click();
  await expect(lost.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();

  // The new password works on a third device.
  const third = await otherDevice(browser, 2);
  await third.goto("/login");
  await third.getByRole("button", { name: m["login.havePassword"] }).click();
  await third.getByLabel(m["login.passwordLabel"]).fill(fresh);
  await third.getByRole("button", { name: m["login.submit"], exact: true }).click();
  await expect(third.getByRole("heading", { level: 1, name: m["characters.title"] })).toBeVisible();

  // Once only: the second time the link says so and offers a new one.
  const again = await otherDevice(browser, 3);
  await again.goto(path);
  await expect(again.getByRole("heading", { level: 1, name: m["reset.invalidTitle"] })).toBeVisible();
  await expect(again.getByText(m["reset.invalid"])).toBeVisible();
  await shot(again, `22-reset-invalid-de`);
  await again.getByRole("link", { name: m["reset.again"] }).click();
  await expect(again.getByRole("heading", { level: 1, name: m["login.lostTitle"] })).toBeVisible();

  for (const p of [lost, third, again]) await p.context().close();
});

test("settings: send the link as a test to the saved address", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "Noa");
  await page.goto("/settings");
  const section = page.getByRole("region", { name: m["settings.identity"] });
  // No address saved yet: nothing to test.
  await expect(section.getByRole("button", { name: m["settings.resetTest"] })).toHaveCount(0);

  const email = uniqueEmail("reset-test");
  await section.getByLabel(m["settings.emailLabel"]).fill(email);
  await section.getByRole("button", { name: m["settings.identitySave"] }).click();
  await expect(section.getByText(m["settings.resetTestHelp"])).toBeVisible();
  await section.getByRole("button", { name: m["settings.resetTest"] }).click();
  await expect(page.getByText(m["settings.resetTestSent"])).toBeVisible();
  expect(await mailTo(email)).toMatch(/^Noa: http\S+\/login\/reset\/[\w-]{43}$/m);
  await shot(page, `22-reset-settings-de`);
});
