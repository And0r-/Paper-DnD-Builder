/**
 * A language model and the builder, in the real server: the settings link to
 * the public MCP zip, in both languages; the zip without a login and without
 * a key; the MCP server at /mcp with a key, without one, and opened in a
 * browser.
 */
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

const ZIP = "/downloads/builder-mcp.zip";

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;

  test(`${lang}: the settings link to the MCP zip, which holds no key`, async ({
    page,
    baseURL,
    foreign,
  }) => {
    void foreign;
    await login(page, uniqueEmail(`mcp-${lang}`), lang);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: m["settings.languageModel"] });
    await expect(section.getByText(m["settings.languageModelText"])).toBeVisible();

    // A real link: its address can be copied.
    const link = section.getByRole("link", { name: m["settings.languageModelDownload"] });
    await expect(link).toHaveAttribute("href", ZIP);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("builder-mcp.zip");
    const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    expect(JSON.parse(strFromU8(files["config.json"]!))).toEqual({
      baseUrl: new URL(baseURL!).origin,
      key: "",
    });

    // Nothing was made: no key in the list.
    const keys = page.getByRole("region", { name: m["settings.keys"] });
    await expect(keys.getByText(m["settings.keysNone"])).toBeVisible();
    await expectOneLanguage(page, lang);
    await section.scrollIntoViewIfNeeded();
    await shot(page, `42-sprachmodell-${lang}`);
  });
}

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
