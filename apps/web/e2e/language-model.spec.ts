/**
 * Help from a language model in the settings, in both languages: download
 * the package with a key, see the key once, find it in the list of access
 * keys; download without a key; the limit of keys, worded with a way out.
 */
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;
  const fill = (text: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text);

  test(`${lang}: download the language model package, see its key once`, async ({
    page,
    baseURL,
    foreign,
  }) => {
    void foreign;
    await login(page, uniqueEmail(`mcp-${lang}`), lang);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: m["settings.languageModel"] });
    const keys = page.getByRole("region", { name: m["settings.keys"] });
    await expect(section).toBeVisible();
    await expect(section.getByText(m["settings.languageModelText"])).toBeVisible();
    await expect(keys.getByText(m["settings.keysNone"])).toBeVisible();

    // A key goes in by default; the sentence under it says what that means.
    const withKey = section.getByLabel(m["settings.languageModelWithKey"]);
    await expect(withKey).toBeChecked();
    await expect(section.getByText(m["settings.languageModelWithKeyText"])).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("button", { name: m["settings.languageModelDownload"] }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("builder-mcp.zip");
    await expect(section.getByText(m["settings.languageModelDone"])).toBeVisible();

    // The key, once, with the same key inside the package.
    const field = section.getByLabel(m["settings.languageModelKeyText"]);
    const secret = await field.inputValue();
    expect(secret).toMatch(/^cbk_[A-Za-z0-9_-]{43}$/);
    const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    expect(strFromU8(files["config.json"]!)).toContain(secret);
    await expect(
      section.getByText(fill(m["settings.languageModelKeyListed"], { section: m["settings.keys"] })),
    ).toBeVisible();

    // It stands in the list below and works for a program.
    const list = keys.getByRole("list", { name: m["settings.keysListLabel"] });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText(fill(m["settings.keyItem"], { hint: secret.slice(0, 10) }))).toBeVisible();
    const me = await page.request.get("/api/account", { headers: { authorization: `Bearer ${secret}` } });
    expect(me.status()).toBe(200);
    await expectOneLanguage(page, lang);
    await section.scrollIntoViewIfNeeded();
    await shot(page, `42-sprachmodell-schluessel-${lang}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await expectOneLanguage(page, lang);
    await shot(page, `42-sprachmodell-schluessel-desktop-${lang}`);

    // Shown once: gone after "Done" and after a reload.
    await section.getByRole("button", { name: m["settings.keyDone"] }).click();
    await expect(field).toHaveCount(0);
    await page.reload();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    expect(await page.content()).not.toContain(secret);

    // Without a key: a file, no new key, the list unchanged.
    await withKey.uncheck();
    await expect(section.getByText(m["settings.languageModelWithoutKeyText"])).toBeVisible();
    const [plain] = await Promise.all([
      page.waitForEvent("download"),
      section.getByRole("button", { name: m["settings.languageModelDownload"] }).click(),
    ]);
    const plainFiles = unzipSync(new Uint8Array(await readFile((await plain.path())!)));
    expect(strFromU8(plainFiles["config.json"]!)).not.toContain("cbk_");
    await expect(section.getByText(m["settings.languageModelDone"])).toBeVisible();
    await expect(section.getByLabel(m["settings.languageModelKeyText"])).toHaveCount(0);
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // At the limit: no key, a way out named.
    const origin = { origin: new URL(baseURL!).origin };
    for (let i = 0; i < 19; i++) {
      const r = await page.request.post("/api/account/keys", {
        headers: origin,
        data: { name: `Test ${i}` },
      });
      expect(r.status()).toBe(201);
    }
    await withKey.check();
    await section.getByRole("button", { name: m["settings.languageModelDownload"] }).click();
    await expect(
      section
        .getByRole("alert")
        .getByText(fill(m["settings.languageModelTooMany"], { max: 20, section: m["settings.keys"] })),
    ).toBeVisible();
    await expect(section.getByLabel(m["settings.languageModelKeyText"])).toHaveCount(0);
    await expectOneLanguage(page, lang);
  });
}
