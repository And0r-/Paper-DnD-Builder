/**
 * A choice with `held`: the step names what the character already carries,
 * and "choose for me" picks the options about those things.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { expect, expectOneLanguage, login, shot, test, uniqueEmail } from "./helpers.ts";

test("a step names what the character carries and recommends it", async ({ page, foreign }) => {
  void foreign;
  await login(page, uniqueEmail("held"));
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  const answers: [string, unknown][] = [
    ["calling", { pick: "calling.river-runner" }],
    ["gear", { pick: "item.trail-boots" }],
  ];
  for (const [choice, answer] of answers) {
    const r = await req.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }

  await page.goto(`/c/${id}/step/handling-river-runner`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Mit welchen Dingen kennst du jeden Handgriff?",
  );
  await expect(page.locator("[data-held]")).toHaveText(
    "In deinem Gepäck hast du: Bootshaken und Wanderstiefel.",
  );
  await expectOneLanguage(page, "de");
  await shot(page, "60-handgriffe-was-du-hast");

  // "Choose for me" takes exactly the things on hand.
  await page.getByRole("button", { name: m["flow.chooseForMe"] }).click();
  await expect(page.getByRole("checkbox", { name: "Bootshaken" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Wanderstiefel" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Seil" })).not.toBeChecked();
});
