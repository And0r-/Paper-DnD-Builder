/**
 * A switch card ticks wherever it is clicked (AND-342): the drawn box, the
 * title, the frame, the sentence, and the space key on the focused box.
 * Each exactly once. Runs in Chromium and in desktop Firefox, where the
 * owner found the drawn box of the extension switch did nothing.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import type { DraftView } from "../src/ui/api.ts";
import { expect, signup, test } from "./helpers.ts";

const SWITCH = m["extensions.on"].replace("{name}", "Gezeiten im Nebelland");

test("the extension switch ticks once from anywhere on its card", async ({ page, foreign }) => {
  void foreign;
  test.skip(!!process.env["E2E_PACKAGES_DIR"], "uses the demo extension");
  await signup(page, "kartenklick");
  await page.getByRole("link", { name: m["characters.emptyAction"] }).click();
  const box = page.getByRole("checkbox", { name: SWITCH });
  await expect(box).toBeChecked();
  const id = /\/c\/([^/]+)\//.exec(page.url())![1]!;
  const card = page.locator(".option", { has: box });

  let on = true;
  const clicks: [string, () => Promise<void>][] = [
    ["drawn box", () => card.locator(".option__mark").click()],
    ["title", () => card.getByText(SWITCH).click()],
    ["frame", () => card.click({ position: { x: 4, y: 4 } })],
    ["sentence", () => card.locator(".option__short").click()],
    [
      "space key",
      async () => {
        await box.focus();
        await page.keyboard.press("Space");
      },
    ],
  ];
  for (const [where, click] of clicks) {
    await click();
    on = !on;
    await expect(box, where).toBeChecked({ checked: on });
    await expect(card, where).not.toHaveAttribute("aria-busy");
    await expect(box, where).toBeChecked({ checked: on });
    const stored = (await (await page.request.get(`/api/drafts/${id}`)).json()) as DraftView;
    expect(stored.draft.extensions, where).toEqual(on ? ["demo-tides"] : []);
  }
});
