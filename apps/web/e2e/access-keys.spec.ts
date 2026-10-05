/**
 * Access keys in the settings, in both languages: make one, see it once,
 * use it, find it in the list with its date, withdraw it.
 */
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;

  test(`${lang}: make, show once, use and withdraw an access key`, async ({ page, context, foreign }) => {
    void foreign;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page, uniqueEmail(`keys-${lang}`), lang);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: m["settings.keys"] });
    await expect(section).toBeVisible();
    await expect(section.getByText(m["settings.keysNone"])).toBeVisible();

    await section.getByRole("button", { name: m["settings.keyCreate"] }).click();
    await expect(section.getByText(m["settings.keyNewTitle"])).toBeVisible();
    const field = section.getByLabel(m["settings.keyNewText"]);
    const secret = await field.inputValue();
    expect(secret).toMatch(/^cbk_[A-Za-z0-9_-]{43}$/);
    await section.getByRole("button", { name: m["settings.keyCopy"] }).click();
    await expect(section.getByRole("button", { name: m["settings.keyCopied"] })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);

    // The list shows the start of the key and the day it was made, never the key.
    const hint = secret.slice(0, 10);
    const list = section.getByRole("list", { name: m["settings.keysListLabel"] });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText(m["settings.keyItem"].replace("{hint}", hint))).toBeVisible();
    const day = new Intl.DateTimeFormat(lang, { dateStyle: "long" }).format(new Date());
    await expect(list.getByText(m["settings.keyCreated"].replace("{date}", day))).toBeVisible();
    await expectOneLanguage(page, lang);
    await shot(page, `40-schluessel-neu-${lang}`);

    // A program with the key works in this account.
    const auth = { authorization: `Bearer ${secret}` };
    const me = await page.request.get("/api/account", { headers: auth });
    expect(me.status()).toBe(200);

    // Shown once: gone after "Done" and after a reload.
    await section.getByRole("button", { name: m["settings.keyDone"] }).click();
    await expect(field).toHaveCount(0);
    await page.reload();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    expect(await page.content()).not.toContain(secret);

    await list.getByRole("button", { name: m["settings.keyRevokeLabel"].replace("{hint}", hint) }).click();
    const dialog = page.getByRole("dialog", { name: m["settings.keyRevokeTitle"] });
    await expect(dialog.getByText(m["settings.keyRevokeText"].replace("{hint}", hint))).toBeVisible();
    await expectOneLanguage(page, lang);
    await shot(page, `41-schluessel-zurueckziehen-${lang}`);
    await dialog.getByRole("button", { name: m["settings.keyRevokeConfirm"] }).click();
    await expect(page.getByText(m["settings.keyRevoked"])).toBeVisible();
    await expect(section.getByText(m["settings.keysNone"])).toBeVisible();

    const after = await page.request.get("/api/account", { headers: auth });
    expect(after.status()).toBe(401);
    expect((await after.json()).error.code).toBe("keyNotValid");

    // The privacy page names the keys.
    await page.goto("/privacy");
    await expect(page.getByText(m["privacy.keys"])).toBeVisible();
    await expectOneLanguage(page, lang);
  });
}
