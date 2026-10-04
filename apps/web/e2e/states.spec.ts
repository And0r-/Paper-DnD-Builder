/**
 * Designed error states: saving fails without blocking and retries by
 * itself; a list that cannot load says so and offers to try again.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, login, makeCharacter, shot, test, uniqueEmail } from "./helpers.ts";

test("saving keeps the choice on screen while the server is away, then catches up", async ({
  page,
  foreign,
}) => {
  void foreign;
  await login(page, uniqueEmail("states"));
  const id = await makeCharacter(page, false);

  await page.goto(`/c/${id}/step/gear`);
  await page.route("**/api/drafts/*/answers/*", (route) => route.abort("internetdisconnected"));
  await page.getByRole("main").getByText("Reisemantel", { exact: true }).click();
  await expect(page.getByText(m["save.offline"])).toBeVisible();
  await expect(page.getByRole("radio", { name: "Reisemantel" })).toBeChecked();
  await shot(page, "50-speichern-keine-verbindung");

  await page.unroute("**/api/drafts/*/answers/*");
  await expect(page.getByText(m["save.saved"])).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Reisemantel" })).toBeChecked();
});

test("the character list shows a designed error and can try again", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("states2"));
  await page.route("**/api/drafts", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.goto("/characters");
  await expect(page.getByText(m["characters.loadError"])).toBeVisible();
  await shot(page, "51-liste-fehler");
  await page.unroute("**/api/drafts");
  await page.getByRole("button", { name: m["common.retry"] }).click();
  await expect(page.getByText(m["characters.emptyTitle"])).toBeVisible();
});
