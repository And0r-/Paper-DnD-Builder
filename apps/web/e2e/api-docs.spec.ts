/**
 * The API reference at /api/docs (Scalar): every route of openapi.json on
 * screen, nothing loaded from elsewhere, no CSP violation, no console error,
 * and "Try it" with a real access key answers from this server. The settings
 * link to it next to MCP, in both languages.
 */
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { expect, login, SHOTS, test, uniqueEmail } from "./helpers.ts";

const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { summary: string }>>;
};
const summaries = Object.values(spec.paths).flatMap((item) => Object.values(item).map((op) => op.summary));

/** Console errors and CSP violations; a violation is reported before any request is made. */
async function watchErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
    ),
  );
  return errors;
}

/** The visible part only: the whole reference is too long for one picture. */
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.describe("API reference", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test("shows every route, from this server alone", async ({ page, foreign }) => {
    void foreign;
    const errors = await watchErrors(page);
    await page.goto("/api/docs");
    await expect(page.getByRole("heading", { level: 1, name: "Character builder HTTP API" })).toBeVisible();
    await expect(page).toHaveTitle("Character builder HTTP API");
    // The app's own font, not Scalar's.
    const font = await page
      .locator(".scalar-app")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toContain("Atkinson Hyperlegible Next");

    // Every operation of openapi.json is in the side bar, once each group is open.
    const closed = page.getByRole("button", { name: /^Open Group - / });
    await expect(closed.first()).toBeVisible();
    while ((await closed.count()) > 0) await closed.first().click();
    const sidebar = await page.locator(".t-doc__sidebar").innerText();
    expect(summaries.length).toBeGreaterThan(40);
    expect(summaries.filter((s) => !sidebar.includes(s))).toEqual([]);
    // Nothing that leads to Scalar's services: no online client, no AI, no MCP generator.
    await expect(page.getByText("Open API Client")).toHaveCount(0);
    await expect(page.getByText(/Ask AI|Generate MCP/)).toHaveCount(0);
    await shot(page, "90-api-docs");
    expect(errors).toEqual([]);
  });

  test("Try it with an access key answers from this server", async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail("api-docs"), "en");
    const made = await page.request.post("/api/account/keys", { data: { name: "API page" } });
    const secret = ((await made.json()) as { key: { secret: string } }).key.secret;
    expect(secret).toMatch(/^cbk_/);
    // Only the key counts: without the session cookie, so "Try it" cannot pass on the cookie.
    await page.context().clearCookies();
    const errors = await watchErrors(page);

    await page.goto("/api/docs#tag/account/GET/api/account");
    await page.getByPlaceholder("Token").first().fill(secret);
    await page.getByRole("button", { name: "Test Request (get /api/account)" }).click();
    const client = page.getByRole("dialog");
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/account") && r.method() === "GET");
    await client.getByRole("button", { name: /^Send/ }).first().click();
    const request = await sent;
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(request.headers()["authorization"]).toBe(`Bearer ${secret}`);
    expect((await request.response())?.status()).toBe(200);
    await expect(client.getByText(/200 OK/).first()).toBeVisible();
    await shot(page, "91-api-docs-try");

    // The key is not kept in the browser.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain(secret);
    expect(errors).toEqual([]);
  });
});

for (const lang of ["de", "en"] as const) {
  const m = lang === "de" ? de : en;

  test(`${lang}: the settings link to the API reference next to MCP`, async ({ page, foreign }) => {
    void foreign;
    await login(page, uniqueEmail(`api-link-${lang}`), lang);
    await page.goto("/settings");
    const section = page.getByRole("region", { name: m["settings.keys"] });
    await expect(section.getByRole("link", { name: m["menu.mcp"], exact: true })).toHaveAttribute(
      "href",
      "/mcp/setup",
    );
    const api = section.getByRole("link", { name: m["menu.api"], exact: true });
    await expect(api).toHaveAttribute("href", "/api/docs");
    await expect(section.getByText(m["settings.keysApi"])).toBeVisible();
    await api.click();
    await expect(page.getByRole("heading", { level: 1, name: "Character builder HTTP API" })).toBeVisible();

    await page.goto("/mcp/setup");
    await expect(page.getByRole("link", { name: m["menu.api"], exact: true })).toHaveAttribute(
      "href",
      "/api/docs",
    );
  });
}
