/**
 * What a newcomer stumbled over in the live help test (AND-272):
 *
 * 1. Joining asks which character comes along. A finished one is chosen
 *    already, no empty "Unnamed" is made, and the game master's page shows
 *    it without reloading.
 * 2. Both press "−" on the same score at the same moment: one counts, and
 *    the window whose press gave way is told so.
 * 3. Cut off, the dots of the others turn grey, and come back green.
 * 4. The MCP page says first that only those who build with a language
 *    model need it.
 * 5. The overview follows a change made elsewhere: the number that
 *    depends on it changes, without reloading.
 *
 * Screenshots at 390 px wide, as the phone in the test.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import { answerCharacter, expect, expectOneLanguage, makeCharacter, shot, signup, test } from "./helpers.ts";

const m = de;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function secondBrowser(browser: Browser, tag: string, viewport: typeof PHONE): Promise<Page> {
  const context = await browser.newContext({
    locale: "de-DE",
    viewport,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + tag.length * 11) % 250}` },
  });
  return context.newPage();
}

async function makeCampaign(page: Page, name: string) {
  const made = await page.request.post("/api/campaigns", { data: { name } });
  expect(made.status()).toBe(201);
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };
  return { id: campaign.id, path: new URL(campaign.inviteUrl).pathname };
}

const bar = (page: Page) => page.locator(".livebar");

test("joining asks which character comes along; the game master sees it without reloading", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await page.setViewportSize(DESKTOP);
  await signup(page, "Ben");
  const campaign = await makeCampaign(page, "Dienstagsrunde");
  await page.goto(`/campaigns/${campaign.id}`);
  await expect(page.getByText(m["campaign.noPlayers"])).toBeVisible();

  // Mia has a finished character already, and a second, older one in another campaign.
  const mia = await secondBrowser(browser, "mia", PHONE);
  await signup(mia, "Mia");
  const other = await makeCampaign(mia, "Andere Runde");
  const elsewhere = await mia.request.post("/api/drafts", {
    data: { packageId: "demo", campaignId: other.id },
  });
  const elsewhereId = ((await elsewhere.json()) as { draft: { id: string } }).draft.id;
  await answerCharacter(mia, elsewhereId);
  const lina = await makeCharacter(mia);
  const rename = (await (await mia.request.get(`/api/drafts/${lina}`)).json()) as {
    draft: { version: number };
  };
  expect(
    (
      await mia.request.put(`/api/drafts/${lina}/answers/name`, {
        data: { version: rename.draft.version, answer: { text: "Lina" } },
      })
    ).status(),
  ).toBe(200);

  await mia.goto(campaign.path);
  await mia.getByRole("button", { name: m["join.join"] }).click();

  // The question, the campaign named, the finished character without a campaign chosen already.
  await expect(mia.getByRole("heading", { level: 1, name: m["join.bringTitle"] })).toBeVisible();
  await expect(
    mia.getByRole("status").filter({ hasText: m["new.joined"].replace("{name}", "Dienstagsrunde") }),
  ).toBeVisible();
  await expect(mia.getByRole("radio", { name: "Lina" })).toBeChecked();
  await expect(mia.getByRole("radio", { name: "Mira" })).not.toBeChecked();
  await expect(
    mia.getByText(m["join.bringMoves"].replace("{from}", "Andere Runde").replace("{to}", "Dienstagsrunde")),
  ).toBeVisible();
  await expect(mia.getByRole("radio", { name: m["join.bringNew"] })).toBeVisible();
  await expect(mia).toHaveURL(new RegExp(`${campaign.path}$`));
  await expectOneLanguage(mia, "de");
  await shot(mia, "272-1-welcher-charakter");

  // The whole card picks, also "new"; back to Lina, and bring her.
  await mia.getByText(m["join.bringNewText"].replace("{name}", "Dienstagsrunde")).click();
  await expect(mia.getByRole("radio", { name: m["join.bringNew"] })).toBeChecked();
  await expect(mia.getByRole("button", { name: m["join.bringNewGo"] })).toBeVisible();
  await mia.getByRole("radio", { name: "Lina" }).check();
  await mia.getByRole("button", { name: m["join.bringGo"] }).click();
  await expect(
    mia.getByRole("heading", {
      name: m["join.broughtTitle"].replace("{character}", "Lina").replace("{name}", "Dienstagsrunde"),
    }),
  ).toBeVisible();
  await shot(mia, "272-1-mitgebracht");

  // Lina is in the campaign; no empty character was made.
  const list = (await (await mia.request.get("/api/drafts")).json()) as {
    drafts: { id: string; campaignId: string | null }[];
  };
  expect(list.drafts).toHaveLength(2);
  expect(list.drafts.find((d) => d.id === lina)!.campaignId).toBe(campaign.id);
  expect(list.drafts.find((d) => d.id === elsewhereId)!.campaignId).toBe(other.id);

  // The game master's page shows Mia and Lina, without reloading.
  const player = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Mia" }) });
  await expect(player.getByRole("heading", { level: 4, name: "Lina" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "272-1-spielleitung-sieht-lina");

  // To the character: the overview names the campaign.
  await mia.getByRole("link", { name: m["join.toCharacter"] }).click();
  await mia.waitForURL(new RegExp(`/c/${lina}/overview$`));

  // Opening the link again: already in; Mira may still come along.
  await mia.goto(campaign.path);
  await expect(
    mia.getByRole("heading", { level: 1, name: m["join.alreadyTitle"].replace("{name}", "Dienstagsrunde") }),
  ).toBeVisible();
  await expect(mia.getByRole("heading", { level: 2, name: m["join.bringTitle"] })).toBeVisible();
  await expect(mia.getByRole("radio", { name: "Mira" })).not.toBeChecked();
  await expect(mia.getByRole("radio", { name: m["join.bringNew"] })).toBeChecked();
  await shot(mia, "272-1-schon-dabei");
  await mia.context().close();
});

test("cut off: the dots go grey; at the same moment: a line says so; the overview follows", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await signup(page, "Ben");
  await page.setViewportSize(DESKTOP);
  const campaign = await makeCampaign(page, "Dienstagsrunde");
  const mia = await secondBrowser(browser, "mia-2", PHONE);
  await signup(mia, "Mia");
  expect((await mia.request.post(`/api/invites/${campaign.path.split("/").at(-1)}/join`)).status()).toBe(200);
  const made = await mia.request.post("/api/drafts", {
    data: { packageId: "demo", campaignId: campaign.id },
  });
  const id = ((await made.json()) as { draft: { id: string } }).draft.id;
  await answerCharacter(mia, id, false);

  // ------------------------------------------------ 5. the overview follows
  await mia.goto(`/c/${id}/overview`);
  // The first number of the overview depends on Kraft.
  const stamina = mia.locator(".values .value").first().locator(".value__number");
  await expect(stamina).toBeVisible();
  const before = await stamina.textContent();
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const r = await page.request.put(`/api/drafts/${id}/answers/scores`, {
    data: {
      version: view.draft.version,
      answer: { method: 0, assign: { mightBase: 11, graceBase: 7, witBase: 9, heartBase: 8 } },
    },
  });
  expect(r.status()).toBe(200);
  await expect(stamina).not.toHaveText(before!);
  await shot(mia, "272-5-ueberblick-folgt");

  // ------------------------------------------- 2. both press at the same moment
  await mia.goto(`/c/${id}/step/scores`);
  await page.goto(`/c/${id}/step/scores`);
  await expect(bar(mia)).toContainText(m["live.person.gameMaster"].replace("{name}", "Ben"));
  await expect(bar(page)).toContainText("Mia");
  const minus = (p: Page) => p.getByRole("button", { name: "Kraft senken" });
  await Promise.all([minus(mia).click(), minus(page).click()]);
  // One "−" counts: the server takes the first, the second window is told that its own gave way.
  await expect(minus(mia)).toBeEnabled();
  const overruled = m["live.told.overruled"].split("{line}. ")[1]!;
  const told = (p: Page) => bar(p).locator("[data-told]", { hasText: overruled });
  await expect
    .poll(async () => (await told(mia).count()) + (await told(page).count()), { timeout: 10_000 })
    .toBe(1);
  const loser = (await told(mia).count()) > 0 ? mia : page;
  await shot(loser, "272-2-gleichzeitig");

  // ---------------------------------------------------- 3. cut off: grey dots
  await expect(bar(mia).locator(".livebar__dot--stale")).toHaveCount(0);
  await mia.context().setOffline(true);
  await expect(bar(mia).locator(".livebar__dot--stale")).toHaveCount(1);
  await expect(bar(mia)).toContainText(m["live.unknown"]);
  await expect(bar(mia)).toContainText(m["live.lost"]);
  await shot(mia, "272-3-ohne-netz-grau");
  // That the game master's bar lets go of Mia sooner (a ping every 10 s) cannot be shown here:
  // Chromium's offline switch keeps an open WebSocket to localhost going, pongs and all.
  await mia.context().setOffline(false);
  await expect(bar(mia).locator(".livebar__dot--stale")).toHaveCount(0, { timeout: 20_000 });
  await expect(bar(mia).locator(".livebar__dot")).toHaveCount(1);
  await mia.context().close();
});

test("the MCP page says first who needs it, in plain words", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/mcp/setup");
  await expect(page.getByRole("heading", { level: 1, name: m["mcp.title"] })).toBeVisible();
  const first = page.locator(".mcp-setup > *").nth(1);
  await expect(first).toContainText(m["mcp.onlyIf"]);
  const text = await page.locator("main, .auth").first().innerText();
  // Bearer stays only where a program shows that very word, and is explained there.
  expect(text).not.toMatch(/Kopfzeile/);
  expect(text).toContain(m["mcp.claudeCodeText"]);
  await expectOneLanguage(page, "de");
  await shot(page, "272-4-mcp-oben");

  await signup(page, "Mia");
  await page.goto("/mcp/setup");
  await page.getByRole("link", { name: m["mcp.toCharacters"] }).click();
  await page.waitForURL(/\/characters$/);
});
