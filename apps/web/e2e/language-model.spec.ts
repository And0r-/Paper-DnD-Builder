/**
 * A language model and the builder, in the real server: the page /mcp/setup
 * without a login and from the menu, in both languages, on a phone and a
 * large screen; the lean settings; the zip without a login and without
 * a key; the MCP server at /mcp with a key, without one, and opened in a
 * browser.
 */
import AxeBuilder from "@axe-core/playwright";
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { chooseLanguage, expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

const ZIP = "/downloads/builder-mcp.zip";

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;

  test(`${lang}: the MCP page without a login, with the address and the zip as a real link`, async ({
    page,
    context,
    baseURL,
    foreign,
  }) => {
    void foreign;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/mcp/setup");
    if (lang === "en") await chooseLanguage(page, "en");
    await expect(page.getByRole("heading", { name: m["mcp.title"], level: 1 })).toBeVisible();
    const origin = new URL(baseURL!).origin;

    // The address, to copy.
    const address = page.getByRole("region", { name: m["mcp.address"] });
    await expect(address.getByText(`${origin}/mcp`, { exact: true })).toBeVisible();
    await address.getByRole("button", { name: `${m["settings.keyCopy"]}: ${m["mcp.addressLabel"]}` }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/mcp`);

    // Not logged in: the way to a key goes through the login.
    const key = page.getByRole("region", { name: m["mcp.key"] });
    await expect(key.getByRole("link", { name: m["mcp.keyLoginButton"] })).toHaveAttribute("href", "/login");

    // One block per program, the command with the address and a placeholder for the key.
    const programs = page.getByRole("region", { name: m["mcp.programs"] });
    for (const name of ["Claude Code", "Cursor", "Open WebUI", m["mcp.otherPrograms"], m["mcp.local"]]) {
      await expect(programs.getByRole("heading", { name, level: 3 })).toBeVisible();
    }
    await expect(
      programs.getByText(
        `claude mcp add --transport http ${m["mcp.serverName"]} ${origin}/mcp --header "Authorization: Bearer ${m["mcp.keyPlaceholder"]}"`,
      ),
    ).toBeVisible();

    // A real link: its address can be copied. The zip holds no key.
    const self = page.getByRole("region", { name: m["mcp.self"] });
    const link = self.getByRole("link", { name: m["mcp.download"] });
    await expect(link).toHaveAttribute("href", ZIP);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("builder-mcp.zip");
    const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    expect(JSON.parse(strFromU8(files["config.json"]!))).toEqual({ baseUrl: origin, key: "" });

    await expect(page.getByText(m["mcp.privacyKey"])).toBeVisible();
    await expectOneLanguage(page, lang);
    await shot(page, `42-mcp-handy-${lang}`);
  });

  test(`${lang}: the menu leads to the MCP page, which leads to a new key; the settings are lean`, async ({
    page,
    foreign,
  }) => {
    void foreign;
    await login(page, uniqueEmail(`mcp-${lang}`), lang);
    await page.goto("/settings");
    // The old section is gone: no zip link in the settings, a sentence leads to the MCP page.
    await expect(page.getByRole("heading", { name: m["settings.keys"] })).toBeVisible();
    await expect(page.locator(`a[href="${ZIP}"]`)).toHaveCount(0);
    const keys = page.getByRole("region", { name: m["settings.keys"] });
    await expect(keys.getByRole("link", { name: m["menu.mcp"] })).toHaveAttribute("href", "/mcp/setup");
    await expectOneLanguage(page, lang);

    await page.getByRole("button", { name: m["menu.open"] }).click();
    await page
      .getByRole("dialog", { name: m["menu.title"] })
      .getByRole("link", { name: m["menu.mcp"] })
      .click();
    await expect(page.getByRole("heading", { name: m["mcp.title"], level: 1 })).toBeVisible();
    await expectOneLanguage(page, lang);

    await page
      .getByRole("region", { name: m["mcp.key"] })
      .getByRole("link", { name: m["mcp.keyCreate"] })
      .click();
    await expect(page).toHaveURL(/\/settings#new-key$/);
    await expect(page.getByLabel(m["settings.keyName"])).toBeFocused();
  });
}

test.describe("desktop", () => {
  test.use({
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });

  for (const lang of ["de", "en"] as const) {
    const m = lang === "de" ? de : en;
    test(`${lang}: the MCP page on a large screen, logged in`, async ({ page, foreign }) => {
      void foreign;
      await login(page, uniqueEmail(`mcp-desk-${lang}`), lang);
      await page.goto("/mcp/setup");
      await expect(page.getByRole("heading", { name: m["mcp.title"], level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: m["mcp.download"] })).toHaveAttribute("href", ZIP);
      await expectOneLanguage(page, lang);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations).toEqual([]);
      await shot(page, `43-mcp-desktop-${lang}`);
    });
  }
});

test("the zip and /mcp without a login; /mcp with a key", async ({ page, playwright, baseURL }) => {
  // Like curl: no cookie, no key.
  const anyone = await playwright.request.newContext({ baseURL: baseURL! });
  const zip = await anyone.get(ZIP);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect(zip.headers()["content-disposition"]).toBe('attachment; filename="builder-mcp.zip"');
  const files = unzipSync(new Uint8Array(await zip.body()));
  expect(Object.keys(files).sort()).toEqual([
    "ANLEITUNG.md",
    "README.md",
    "claude_desktop_config.json",
    "config.json",
    "server.mjs",
  ]);
  for (const data of Object.values(files)) expect(strFromU8(data)).not.toMatch(/cbk_[A-Za-z0-9_-]{20}/);

  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const accept = { accept: "application/json, text/event-stream" };
  const noKey = await anyone.post("/mcp", { data: rpc, headers: accept });
  expect(noKey.status()).toBe(401);
  expect((await noKey.json()).error.message).toMatch(/Settings, Access keys/);

  // A browser goes to the page about it.
  const opened = await anyone.get("/mcp", { headers: { accept: "text/html" }, maxRedirects: 0 });
  expect(opened.status()).toBe(303);
  expect(opened.headers()["location"]).toBe("/mcp/setup");

  // With a key made in the settings, the tools answer.
  await login(page, uniqueEmail("mcp-http"), "en");
  const made = await page.request.post("/api/account/keys", {
    headers: { origin: new URL(baseURL!).origin },
    data: { name: "Language model" },
  });
  const secret: string = (await made.json()).key.secret;
  const listed = await anyone.post("/mcp", {
    data: rpc,
    headers: { ...accept, authorization: `Bearer ${secret}` },
  });
  expect(listed.status()).toBe(200);
  expect((await listed.json()).result.tools.length).toBeGreaterThan(10);
  const characters = await anyone.post("/mcp", {
    data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_characters", arguments: {} } },
    headers: { ...accept, authorization: `Bearer ${secret}` },
  });
  expect(JSON.parse((await characters.json()).result.content[0].text)).toEqual([]);
  await anyone.dispose();
});
