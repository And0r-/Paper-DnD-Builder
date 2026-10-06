/**
 * Shared by the sheet specs: the online sheet (AND-181, screen as approved in round 2 of AND-177), on
 * a phone and at a desk: the original as the builder makes it, the first
 * change makes a copy silently and the account opens it next time, rows
 * written in and crossed out, the play state the same on the original and
 * every copy and through a level up, "clear all ticks", another device
 * that was first (409), and a character that is not finished.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIResponse, Page } from "@playwright/test";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import {
  animationsDone,
  expect,
  expectOneLanguage,
  login,
  makeCharacter,
  shot,
  test,
  uniqueEmail,
} from "./helpers.ts";

const m = de;

interface Model {
  name: string;
  level: number;
  sections: {
    id: string;
    kind: string;
    title: string;
    boxes?: { label: string; style: string; field?: string; circles: number; squares: number }[];
    scores?: { label: string; value: string }[];
    items?: unknown[];
    rows?: { usesField?: string; uses: unknown }[];
    playedByField?: string;
    field?: string;
  }[];
}

interface DraftView {
  draft: { id: string; version: number };
  evaluation: {
    complete: boolean;
    steps: { id: string; choices: string[]; pool?: { recommended: string[] } }[];
    choices: Record<string, { id: string; kind: string; status: string; recommended?: unknown }>;
  };
}

/** Every place to write or tick the screen shows for a model, in its order (as `playFields` in @builder/sheet). */
function fieldIds(model: Model): string[] {
  const out: string[] = [];
  for (const s of model.sections) {
    if (s.kind === "header" && s.playedByField) out.push(s.playedByField);
    if (s.kind === "statBoxes") for (const b of s.boxes!) if (b.field) out.push(b.field);
    if (s.kind === "checkList")
      for (const i of s.items as { field?: string }[]) if (i.field) out.push(i.field);
    if (s.kind === "featureTable")
      for (const r of s.rows!)
        if (r.usesField && r.uses !== null && !("text" in (r.uses as object))) out.push(r.usesField);
    if ((s.kind === "list" || s.kind === "notes") && s.field) out.push(s.field);
  }
  return out;
}

async function axe(page: Page) {
  await animationsDone(page);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

const original = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/drafts/${id}/sheet`)).json()) as Model;
const copies = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/drafts/${id}/sheet-copies`)).json()) as {
    copies: { id: string }[];
    opened: string | null;
  };

/** Starts raising a finished character through the API; what the new level asks stays open. */
async function levelUp(page: Page, id: string, level: number): Promise<void> {
  const view = (await (await page.request.get(`/api/drafts/${id}`)).json()) as DraftView;
  const r = await page.request.post(`/api/drafts/${id}/level-up`, {
    data: { version: view.draft.version, level },
  });
  expect(r.status()).toBe(200);
}

/** Answers what is open with the recommendations and finishes, as "choose for me" would. */
async function finishRaise(page: Page, id: string): Promise<void> {
  const req = page.request;
  let view = (await (await req.get(`/api/drafts/${id}`)).json()) as DraftView;
  const send = async (r: Promise<APIResponse>, what: string) => {
    const res = await r;
    expect(res.status(), what).toBe(200);
    view = (await res.json()) as DraftView;
  };
  for (let guard = 0; guard < 50 && !view.evaluation.complete; guard++) {
    const ev = view.evaluation;
    const waits = (c: string) => ev.choices[c]!.kind !== "info" && ev.choices[c]!.status !== "answered";
    const step = ev.steps.find((s) => s.choices.some(waits))!;
    if (step.pool) {
      await send(
        req.put(`/api/drafts/${id}/pools/${encodeURIComponent(step.id)}`, {
          data: { version: view.draft.version, picks: step.pool.recommended },
        }),
        step.id,
      );
      continue;
    }
    const open = ev.choices[step.choices.find(waits)!]!;
    const rec = open.recommended;
    const answer =
      open.kind === "pickOne"
        ? { pick: (rec as string[])[0] }
        : open.kind === "pickMany"
          ? { picks: rec }
          : rec;
    await send(
      req.put(`/api/drafts/${id}/answers/${encodeURIComponent(open.id)}`, {
        data: { version: view.draft.version, answer },
      }),
      open.id,
    );
  }
  await send(req.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } }), "finish");
}

/** The tests for one screen size; `sheet.spec.ts` runs them on a phone, `sheet-desk.spec.ts` at a desk. */
export function sheetTests(device: "phone" | "desk"): void {
  {
    /** The tools: in the bar at a desk, in the app's menu on a phone. */
    const tools = async (page: Page) => {
      if (device === "desk") return page.getByRole("group", { name: m["sheet.tools"] });
      await page.getByRole("button", { name: m["menu.open"] }).click();
      const menu = page.getByRole("dialog", { name: m["menu.title"] });
      await expect(menu.getByRole("heading", { name: m["sheet.group"] })).toBeVisible();
      return menu;
    };
    const closeTools = async (page: Page) => {
      if (device === "phone") await page.getByRole("button", { name: m["common.close"] }).click();
    };
    const pickVersion = async (page: Page, label: string | RegExp) => {
      const t = await tools(page);
      const select = t.getByLabel(m["sheet.version"]);
      const option = select.locator("option").filter({ hasText: label });
      await select.selectOption(await option.first().getAttribute("value"));
      await closeTools(page);
    };
    const versionShown = async (page: Page) => {
      const t = await tools(page);
      const select = t.getByLabel(m["sheet.version"]);
      const text = await select.locator("option:checked").textContent();
      await closeTools(page);
      return text;
    };

    test(`original, first change makes a copy, rows, versions (${device})`, async ({ page, foreign }) => {
      void foreign;
      await login(page, uniqueEmail(`sheet-${device}`));
      const id = await makeCharacter(page);
      const model = await original(page, id);

      // "View" in the list leads to the sheet.
      await page.goto("/characters");
      await page.getByRole("link", { name: `${m["characters.view"]}: Mira` }).click();
      await expect(page).toHaveURL(new RegExp(`/c/${id}/bogen$`));
      await expect(page.getByRole("heading", { level: 1, name: "Mira" })).toBeVisible();
      await expect(page.locator(".topbar__menu")).toBeVisible();
      if (device === "desk") await expect(page.getByRole("group", { name: m["sheet.tools"] })).toBeVisible();
      else await expect(page.getByRole("group", { name: m["sheet.tools"] })).toBeHidden();

      // Sections in the model's order, and every place to write or tick.
      expect(
        await page.locator("[data-section]").evaluateAll((n) => n.map((e) => e.getAttribute("data-section"))),
      ).toEqual(model.sections.map((s) => s.id));
      expect(
        await page
          .locator(".vsheet [data-field]")
          .evaluateAll((n) => n.map((e) => e.getAttribute("data-field"))),
      ).toEqual(fieldIds(model));
      expect(await versionShown(page)).toBe(m["sheet.original"]);
      await expectOneLanguage(page, "de");
      await axe(page);
      await shot(page, `96-sheet-original-${device}`);

      // The first change: tap, type, Enter. Nothing opens; the copy is made silently.
      const wit = model.sections.flatMap((s) => s.scores ?? []).find((sc) => sc.label === "Klugheit")!;
      await page.getByRole("button", { name: `Klugheit: ${wit.value}. Ändern` }).click();
      const input = page.getByRole("textbox", { name: "Klugheit" });
      await expect(input).toBeFocused();
      await input.fill("19");
      await input.press("Enter");
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      let list = await copies(page, id);
      expect(list.copies).toHaveLength(1);
      expect(list.opened).toBe(list.copies[0]!.id);
      expect(await versionShown(page)).toMatch(/^Meine Fassung vom \d+\. \w+, \d\d:\d\d$/);
      // The original stays as the builder makes it.
      expect(
        (await original(page, id)).sections
          .flatMap((s) => s.scores ?? [])
          .find((s) => s.label === "Klugheit")!.value,
      ).toBe(wit.value);

      // In the copy, changes go into it: no second copy. A line written in, then crossed out.
      const gear = model.sections.find((s) => s.kind === "list")!;
      await page.getByRole("button", { name: `Zeile dazu bei ${gear.title}` }).click();
      await page.getByRole("button", { name: `${gear.title}: ${m["sheet.empty"]}. Ändern` }).click();
      await page.getByRole("textbox", { name: gear.title }).fill("Langes Seil");
      await page.getByRole("textbox", { name: gear.title }).press("Enter");
      await expect(page.getByRole("button", { name: `${gear.title}: Langes Seil. Ändern` })).toBeVisible();
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      await page.reload();
      await expect(page.getByRole("button", { name: `${gear.title}: Langes Seil. Ändern` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();
      const rows = (gear.items ?? []).length + 1;
      await page.getByRole("button", { name: `Zeile ${rows} bei ${gear.title} löschen` }).click();
      await expect(page.getByRole("button", { name: `${gear.title}: Langes Seil. Ändern` })).toHaveCount(0);
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      expect((await copies(page, id)).copies).toHaveLength(1);
      await shot(page, `97-sheet-copy-${device}`);

      // Escape takes a change back.
      await page.getByRole("button", { name: "Klugheit: 19. Ändern" }).click();
      await page.getByRole("textbox", { name: "Klugheit" }).fill("3");
      await page.getByRole("textbox", { name: "Klugheit" }).press("Escape");
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeFocused();

      // Back to the original; the account opens it next time.
      await pickVersion(page, m["sheet.original"]);
      await expect(page.getByRole("button", { name: `Klugheit: ${wit.value}. Ändern` })).toBeVisible();
      await expect.poll(async () => (await copies(page, id)).opened).toBeNull();
      await page.reload();
      expect(await versionShown(page)).toBe(m["sheet.original"]);
      await pickVersion(page, /^Meine Fassung/);
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();

      // The end screen names the player's own versions.
      await page.goto(`/c/${id}/done`);
      await expect(page.getByText(de["done.copies.one"])).toBeVisible();
      await page.getByRole("link", { name: m["done.toSheet"] }).click();
      await expect(page).toHaveURL(new RegExp(`/c/${id}/bogen$`));
      list = await copies(page, id);
      expect(list.copies).toHaveLength(1);
    });

    test(`play state on original and copy, through a level up; clear all ticks; another device (${device})`, async ({
      page,
      foreign,
    }) => {
      void foreign;
      await login(page, uniqueEmail(`sheet-play-${device}`));
      const id = await makeCharacter(page);
      const model = await original(page, id);
      const boxes = model.sections.flatMap((s) => s.boxes ?? []);
      const squares = boxes.find((b) => b.style === "boxes" && b.squares > 0 && b.field)!;
      const pencil = boxes.find((b) => b.style === "pencil" && b.field)!;
      await page.goto(`/c/${id}/bogen`);

      // Ticks and pencil: saved, and no copy made.
      await page.getByRole("button", { name: `${squares.label}: Haken 2 von ${squares.squares}` }).click();
      await expect(
        page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("textbox", { name: pencil.label }).fill("18");
      await page.getByRole("textbox", { name: pencil.label }).press("Enter");
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      expect((await copies(page, id)).copies).toHaveLength(0);
      const state = (await (await page.request.get(`/api/drafts/${id}/state`)).json()) as {
        state: Record<string, unknown>;
        version: number;
      };
      expect(state.state).toEqual({ [squares.field!]: { checks: 2 }, [pencil.field!]: 18 });

      // The same in a copy.
      const wit = model.sections.flatMap((s) => s.scores ?? []).find((sc) => sc.label === "Klugheit")!;
      await page.getByRole("button", { name: `Klugheit: ${wit.value}. Ändern` }).click();
      await page.getByRole("textbox", { name: "Klugheit" }).fill("19");
      await page.getByRole("textbox", { name: "Klugheit" }).press("Enter");
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      await page.reload();
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: `${squares.label}: Haken 2 von ${squares.squares}` }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: pencil.label })).toHaveValue("18");

      // Another device was first: the screen loads what it stored and says so.
      const now = (await (await page.request.get(`/api/drafts/${id}/state`)).json()) as { version: number };
      const elsewhere = await page.request.put(`/api/drafts/${id}/state`, {
        data: { version: now.version, state: { [pencil.field!]: 7 } },
      });
      expect(elsewhere.status()).toBe(200);
      await page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }).click();
      await expect(page.getByText(m["sheet.otherDevice"])).toBeVisible();
      await expect(page.getByRole("textbox", { name: pencil.label })).toHaveValue("7");
      const copyId = (await copies(page, id)).copies[0]!.id;
      const kept = (await (await page.request.get(`/api/drafts/${id}/sheet-copies/${copyId}`)).json()) as {
        copy: { version: number };
        model: Model;
      };
      expect(
        (
          await page.request.put(`/api/drafts/${id}/sheet-copies/${copyId}`, {
            data: { version: kept.copy.version, model: { ...kept.model, name: "Mira" } },
          })
        ).status(),
      ).toBe(200);
      await page.getByRole("button", { name: "Klugheit: 19. Ändern" }).click();
      await page.getByRole("textbox", { name: "Klugheit" }).fill("20");
      await page.getByRole("textbox", { name: "Klugheit" }).press("Enter");
      await expect(page.getByText(m["sheet.otherDevice"])).toBeVisible();
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();

      // Ticks again, then clear all ticks: the pencil stays.
      await page.getByRole("button", { name: `${squares.label}: Haken 3 von ${squares.squares}` }).click();
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      const t = await tools(page);
      await t.getByRole("button", { name: m["sheet.clearChecks"] }).click();
      await closeTools(page);
      await expect(
        page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);
      await expect(page.getByRole("textbox", { name: pencil.label })).toHaveValue("7");

      // A tick for the level up.
      await page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }).click();
      await expect(page.locator(".save-status")).toHaveText(m["save.saved"]);

      // Halfway through a level up the original waits for the builder; the copy stays readable.
      await levelUp(page, id, 4);
      await pickVersion(page, m["sheet.original"]);
      await expect(page.getByRole("heading", { name: m["sheet.notFinishedTitle"] })).toBeVisible();
      await expect(page.getByRole("link", { name: m["sheet.toBuilder"] }).first()).toBeVisible();
      await pickVersion(page, /^Meine Fassung/);
      await expect(page.getByRole("button", { name: "Klugheit: 19. Ändern" })).toBeVisible();

      // Finished at level 4: the original says so, the copy stays at 3, the play state stays on both.
      await finishRaise(page, id);
      await page.reload();
      await expect(page.getByRole("button", { name: /Stufe 3\. Ändern$/ })).toBeVisible();
      await expect(
        page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }),
      ).toHaveAttribute("aria-pressed", "true");
      await pickVersion(page, m["sheet.original"]);
      await expect(page.getByRole("button", { name: /Stufe 4\. Ändern$/ })).toBeVisible();
      await expect(
        page.getByRole("button", { name: `${squares.label}: Haken 1 von ${squares.squares}` }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("textbox", { name: pencil.label })).toHaveValue("7");
      await shot(page, `98-sheet-play-${device}`);
    });
  }
}
