/**
 * A question with nothing to pick (AND-286): Keen Study deepens Legends or
 * Mending, and a river runner has neither. The step is not asked, the
 * character can be finished, and the sheet says on the trait's row that
 * there was nothing to choose. The same shape as a second calling whose
 * feature picks among talents the character does not have.
 */
import m from "../src/i18n/messages/de.json" with { type: "json" };
import { MESSAGES } from "@builder/sheet";
import { answerRecommended, expect, signup, test } from "./helpers.ts";

test("a question with nothing to pick is skipped and named on the sheet", async ({ page, foreign }) => {
  void foreign;
  await signup(page, "nothing-to-pick");
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  const id = ((await created.json()) as { draft: { id: string } }).draft.id;
  await answerRecommended(page, id, {
    level: 4,
    calling: "calling.river-runner",
    answers: [["boon-4", { pick: "boon.keen-study" }]],
  });
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as {
    evaluation: {
      complete: boolean;
      open: string[];
      choices: Record<string, { empty?: boolean; options?: string[] }>;
    };
  };
  expect(view.evaluation.choices["keen-study"]).toMatchObject({ empty: true, options: [] });
  expect(view.evaluation.open).toEqual([]);
  expect(view.evaluation.complete).toBe(true);

  // Not in the step list, nothing open on the overview, and it can be finished.
  await page.goto(`/c/${id}/overview`);
  await expect(page.getByRole("heading", { level: 1, name: m["overview.question"] })).toBeVisible();
  const steps = page.getByRole("navigation", { name: m["flow.steps"] });
  await expect(steps.getByRole("link", { name: /Studiertes Talent/ })).toHaveCount(0);
  await expect(page.getByText(m["overview.openTitle"])).toHaveCount(0);
  await page.getByRole("button", { name: m["overview.finish"] }).click();
  await expect(page.getByRole("heading", { level: 1, name: /ist fertig!$/ })).toBeVisible();

  // The sheet: the trait is there and says that there was nothing to choose.
  await page.goto(`/c/${id}/bogen`);
  await expect(page.getByText("Gründliches Studium", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(MESSAGES["de"]!.nothingToChoose)).toBeVisible();
});
