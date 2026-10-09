/**
 * A box's remarks on the sheet (AND-327): the package names short words for
 * a box, each with a condition, e.g. that a roll is made twice. The demo's
 * guard box says so for hillfolk, who stand firm. On screen in both designs,
 * on a phone and at a desk, in German and English; nothing for moorfolk.
 */
import { devices, type Page } from "@playwright/test";
import { answerRecommended, expect, makeCharacter, shot, signup, test } from "./helpers.ts";

const { defaultBrowserType: _desk, ...desk } = devices["Desktop Chrome"];

const REMARK = { de: "Umgeworfen? Zweimal würfeln.", en: "Knocked down? Roll twice." } as const;

async function hillfolk(page: Page): Promise<string> {
  const created = await page.request.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { draft: { id: string } }).draft.id;
  await answerRecommended(page, id, {
    level: 3,
    calling: "calling.lantern-bearer",
    answers: [["folk", { pick: "folk.hillfolk" }]],
  });
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as { draft: { version: number } };
  const finished = await page.request.post(`/api/drafts/${id}/finish`, {
    data: { version: view.draft.version },
  });
  expect(finished.status()).toBe(200);
  return id;
}

async function openSheet(page: Page, id: string, design: "verbose" | "classic") {
  const set = await page.request.patch("/api/account/settings", { data: { print: { design } } });
  expect(set.status()).toBe(200);
  await page.goto(`/c/${id}/bogen`);
  const sheet = page.locator("article[lang]");
  await sheet.locator("[data-section]").first().waitFor();
  return sheet;
}

const remarkOf = { verbose: ".vsheet__box-remarks", classic: ".csheet__box-remarks" } as const;
const boxOf = { verbose: ".vsheet__box", classic: ".csheet__box" } as const;

for (const [device, use] of [
  ["phone", {}],
  ["desk", { ...desk, viewport: { width: 1280, height: 900 } }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use(use);

    for (const lang of ["de", "en"] as const) {
      test(`the guard box says what hillfolk may do, in both designs (${lang})`, async ({ page }) => {
        await signup(page, `remarks-${device}`, lang);
        const hill = await hillfolk(page);
        const moor = await makeCharacter(page);
        for (const design of ["verbose", "classic"] as const) {
          const sheet = await openSheet(page, hill, design);
          const remark = sheet.locator(remarkOf[design]);
          await expect(remark).toHaveCount(1);
          await expect(remark).toHaveText(REMARK[lang]);
          // Inside its own box, under the number.
          const box = sheet.locator(boxOf[design]).filter({ has: page.locator(remarkOf[design]) });
          await expect(box).toHaveCount(1);
          const [value, said] = [
            (await box.locator(`${boxOf[design]}-value`).boundingBox())!,
            (await remark.boundingBox())!,
          ];
          expect(said.y).toBeGreaterThanOrEqual(value.y + value.height - 1);
          await remark.scrollIntoViewIfNeeded();
          await shot(page, `327-remark-${design}-${device}-${lang}`);

          const plain = await openSheet(page, moor, design);
          await expect(plain.locator(remarkOf[design])).toHaveCount(0);
        }
      });
    }
  });
}
