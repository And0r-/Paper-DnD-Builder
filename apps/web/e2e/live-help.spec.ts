/**
 * Live help (AND-246): two people build one character at the same time,
 * each in their own browser. The owner, on a phone, asks for help from the
 * menu and shows the link; a newcomer on a desktop opens it, gets started
 * with a name and lands in the character. Both see who else is there and
 * where; an answer on one screen shows on the other without reloading;
 * the helper points at a card and sends a hint, which goes at a tap and
 * at the next step. Stopping the link puts the helper out at once. The
 * game master reaches a player's character from the campaign with "Help
 * out", without a link.
 */
import type { Browser, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, shot, signup, test } from "./helpers.ts";

const DESKTOP = { width: 1366, height: 900 };
const m = de;

/** A second person in a browser of their own: own cookies, own address, desktop or phone. */
async function secondBrowser(browser: Browser, tag: string, desktop: boolean): Promise<Page> {
  const context = await browser.newContext({
    locale: "de-DE",
    ...(desktop ? { viewport: DESKTOP } : {}),
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(Date.now() + tag.length * 7) % 250}` },
  });
  return context.newPage();
}

async function newDraft(page: Page, campaignId?: string): Promise<string> {
  const r = await page.request.post("/api/drafts", {
    data: { packageId: "demo", level: 3, ...(campaignId ? { campaignId } : {}) },
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { draft: { id: string } }).draft.id;
}

const card = (page: Page, thing: string) => page.locator(`[data-option="${thing}"]`);
const bar = (page: Page) => page.locator(".livebar");

test("help link: owner on a phone, newcomer on a desktop, one character", async ({
  page,
  browser,
  foreign,
}) => {
  void foreign;
  await signup(page, "Lio");
  const id = await newDraft(page);
  await page.goto(`/c/${id}/step/folk`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Alone on the character: no row under the top bar.
  await expect(bar(page)).toBeHidden();

  // ------------------------------------------------ asking for help
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await page
    .getByRole("dialog", { name: m["menu.title"] })
    .getByRole("button", { name: m["help.button"] })
    .click();
  const dialog = page.getByRole("dialog", { name: m["help.title"] });
  await expect(dialog.getByText(m["help.may"])).toBeVisible();
  const link = (await dialog.locator(".copy-text__value").textContent())!.trim();
  expect(link).toMatch(/\/help\/[A-Za-z0-9_-]{22}$/);
  expect((await dialog.locator("svg.qr-code > title").textContent())!.trim()).toBe(link);
  await expectOneLanguage(page, "de");
  await shot(page, "live-01-hilfe-holen-handy");
  await dialog.getByRole("button", { name: m["common.close"] }).click();

  // ------------------------------------------------ the helper joins
  const p2 = await secondBrowser(browser, "helper", true);
  await p2.goto(new URL(link).pathname);
  await expect(
    p2.getByRole("heading", { level: 1, name: m["helpPage.title"].replace("{owner}", "Lio") }),
  ).toBeVisible();
  await shot(p2, "live-02-hilfe-link-desktop");
  await p2.getByLabel(m["login.nameLabel"]).fill("Mara");
  await p2.getByRole("button", { name: m["login.start"] }).click();
  const shown = p2.getByRole("region", { name: m["password.welcome"].replace("{name}", "Mara") });
  await shown.getByRole("button", { name: m["password.done"] }).click();
  await expect(p2).toHaveURL(new RegExp(`/c/${id}/overview$`));
  // Whose character it is, in the top bar.
  await expect(p2.getByRole("banner")).toContainText(m["flow.forPlayer"].replace("{name}", "Lio"));

  // Both see who else is there; the helper's row leads to the owner's step.
  await expect(bar(page)).toContainText(m["live.person.helper"].replace("{name}", "Mara"));
  await expect(bar(p2)).toContainText("Lio");
  await bar(p2).getByRole("link").first().click();
  await expect(p2).toHaveURL(new RegExp(`/c/${id}/step/folk$`));
  // The owner's step list (in the menu on a phone) shows where the helper is now.
  await expect(bar(page).getByRole("link").first()).toHaveAttribute("href", `/c/${id}/step/folk`);
  await expect(p2.locator(".shell__sidebar .steplist__who")).toContainText("Lio");

  // ------------------------------------------------ one answer, both screens
  await card(page, "folk.hillfolk").click();
  await expect(card(page, "folk.hillfolk")).toHaveClass(/option--checked/);
  await expect(card(p2, "folk.hillfolk")).toHaveClass(/option--checked/);
  await expect(bar(p2)).toContainText(m["live.from.person"].replace("{who}", "Lio") + ": Herkunft");

  await card(p2, "folk.moorfolk").click();
  await expect(card(page, "folk.moorfolk")).toHaveClass(/option--checked/);
  await expect(card(page, "folk.hillfolk")).not.toHaveClass(/option--checked/);
  await expect(bar(page)).toContainText(
    m["live.from.person"].replace("{who}", m["live.person.helper"].replace("{name}", "Mara")) + ": Herkunft",
  );
  // The server's state counts: both read the same answer from it.
  const stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    draft: { answers: Record<string, unknown> };
  };
  expect(stored.draft.answers["folk"]).toEqual({ pick: "folk.moorfolk" });

  // ------------------------------------------------ pointing and a hint
  await card(p2, "folk.hillfolk")
    .getByRole("button", { name: /Bergvolk/ })
    .click();
  await expect(card(page, "folk.hillfolk")).toHaveClass(/option--pointed/);
  await expect(card(page, "folk.hillfolk")).toContainText(m["live.pointedHere"].replace("{name}", "Mara"));
  await expect(bar(page)).toContainText(
    m["live.points"].replace("{name}", "Mara").replace("{thing}", "Bergvolk"),
  );

  await bar(p2).getByRole("button", { name: m["live.hintButton"] }).click();
  const hintDialog = p2.getByRole("dialog", { name: m["live.hintTitle"] });
  await hintDialog.getByRole("button", { name: m["live.hintSend"] }).click();
  await expect(hintDialog.getByText(m["live.hintEmpty"])).toBeVisible();
  await hintDialog.getByLabel(m["live.hintLabel"]).fill("Schau dir das Bergvolk an.");
  await hintDialog.getByRole("button", { name: m["live.hintSend"] }).click();
  const hint = page.locator("[data-hint]");
  await expect(hint).toContainText("Mara sagt: Schau dir das Bergvolk an.");
  // The bubble sits in the top bar: it covers neither the cards nor Back / Next.
  const hintBox = (await hint.boundingBox())!;
  const dockBox = (await page.locator(".step-footer__dock").boundingBox())!;
  expect(hintBox.y + hintBox.height).toBeLessThan(dockBox.y);
  await shot(page, "live-03-zeigen-hinweis-handy");
  await shot(p2, "live-04-helfer-desktop");
  // A tap puts it away.
  await hint.click();
  await expect(hint).toBeHidden();

  // A new hint goes at the next step; the pointer too.
  await bar(p2).getByRole("button", { name: m["live.hintButton"] }).click();
  await hintDialog.getByLabel(m["live.hintLabel"]).fill("Jetzt der nächste Schritt.");
  await hintDialog.getByRole("button", { name: m["live.hintSend"] }).click();
  await expect(hint).toContainText("Jetzt der nächste Schritt.");
  await page.getByRole("button", { name: m["common.next"], exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/step/folk$`));
  await expect(hint).toBeHidden();

  // ------------------------------------------------ the owner stops the link
  await page.getByRole("button", { name: m["menu.open"] }).click();
  await page
    .getByRole("dialog", { name: m["menu.title"] })
    .getByRole("button", { name: m["help.button"] })
    .click();
  await dialog.getByRole("button", { name: m["help.end"] }).click();
  await expect(dialog.getByText(m["help.ended"])).toBeVisible();
  await expect(p2.getByText(m["live.helpEndedTitle"])).toBeVisible();
  await expect(bar(page)).toBeHidden();
  // The old link says so too.
  await p2.goto(new URL(link).pathname);
  await expect(p2.getByRole("heading", { level: 1, name: m["helpPage.notFoundTitle"] })).toBeVisible();
});

test("game master helps out from the campaign, without a link", async ({ page, browser, foreign }) => {
  void foreign;
  await signup(page, "Kim");
  const made = await page.request.post("/api/campaigns", { data: { name: "Donnerstagsrunde" } });
  const { campaign } = (await made.json()) as { campaign: { id: string; inviteUrl: string } };

  const player = await secondBrowser(browser, "player", false);
  await signup(player, "Robin");
  const token = new URL(campaign.inviteUrl).pathname.split("/").at(-1)!;
  expect((await player.request.post(`/api/invites/${token}/join`)).status()).toBe(200);
  const id = await newDraft(player, campaign.id);
  await player.goto(`/c/${id}/step/folk`);
  await expect(player.getByRole("heading", { level: 1 })).toBeVisible();

  // The game master opens the campaign on a desktop and helps out.
  await page.setViewportSize(DESKTOP);
  await page.goto(`/campaigns/${campaign.id}`);
  const helpOut = page.getByRole("link", { name: new RegExp(`^${m["characters.helpOut"]}`) });
  await expect(helpOut).toBeVisible();
  await shot(page, "live-05-kampagne-mithelfen");
  await helpOut.click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/`));

  await expect(bar(player)).toContainText(m["live.person.gameMaster"].replace("{name}", "Kim"));
  await expect(bar(page)).toContainText("Robin");
  await bar(page).getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/step/folk$`));

  await card(page, "folk.hillfolk").click();
  await expect(card(player, "folk.hillfolk")).toHaveClass(/option--checked/);
  await expect(bar(player)).toContainText(
    m["live.from.person"].replace("{who}", m["live.person.gameMaster"].replace("{name}", "Kim")) +
      ": Herkunft",
  );
  // The owner gets no pointing buttons: only who helps points.
  await expect(card(player, "folk.hillfolk").locator(".option__point")).toHaveCount(0);
  await expect(card(page, "folk.hillfolk").locator(".option__point")).toHaveCount(1);
  await shot(player, "live-06-spielleitung-hilft-handy");
});
