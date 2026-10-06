import { evaluateDraft, dependentValues, type DraftDocument } from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, sheetFields, type SheetModel } from "./index.ts";
import { sheetModelSchema } from "./schema.ts";
import { demoCharacter, loadDemoPackage, raisedCharacter } from "./testing.ts";

let pkg: ContentPackage;
let level3: DraftDocument;
let level20: DraftDocument;
const createdAt = new Date("2026-10-04T12:00:00Z");

beforeAll(async () => {
  pkg = await loadDemoPackage();
  level3 = demoCharacter(pkg, 3);
  // The same character, raised: every answer kept.
  level20 = raisedCharacter(pkg, level3, 20);
});

const sheet = (doc: DraftDocument, language = "de", units?: Record<string, string>): SheetModel =>
  buildSheetModel(pkg, doc, { language, createdAt, ...(units ? { units } : {}) });

describe("sheet model", () => {
  it("is plain JSON that its schema accepts, as made and after a trip through JSON", () => {
    for (const doc of [level3, level20]) {
      for (const language of ["de", "en"]) {
        const model = sheet(doc, language);
        const copy: unknown = JSON.parse(JSON.stringify(model));
        expect(copy).toEqual(model);
        const parsed = sheetModelSchema.safeParse(copy);
        expect(parsed.error?.issues ?? []).toEqual([]);
      }
    }
  });

  it("refuses a stored copy that does not have the shape", () => {
    const model = sheet(level3);
    expect(sheetModelSchema.safeParse({ ...model, version: 2 }).success).toBe(false);
    expect(sheetModelSchema.safeParse({ ...model, origin: { kind: "original", level: 3 } }).success).toBe(
      false,
    );
    expect(sheetModelSchema.safeParse({ ...model, extra: true }).success).toBe(false);
  });

  it("says it is the original, at which level and when it was made", () => {
    const model = sheet(level20);
    expect(model.origin).toEqual({
      kind: "original",
      level: 20,
      builtAt: "2026-10-04T12:00:00.000Z",
      packageVersion: pkg.manifest.version,
    });
    expect(model.level).toBe(20);
    expect(model.packageId).toBe("demo");
  });

  it("is in the reader's units", () => {
    const pace = (m: SheetModel) =>
      m.sections.flatMap((s) => (s.kind === "statBoxes" ? s.boxes : [])).find((b) => b.valueId === "pace")!;
    expect(pace(sheet(level3, "de")).text).toMatch(/ m$/u);
    expect(pace(sheet(level3, "de", { length: "ft" })).text).toMatch(/ Fuss$/u);
    expect(sheet(level3, "en").units["length"]).toBe("ft");
  });

  it("gives every place to write or tick an id, each one once", () => {
    for (const doc of [level3, level20]) {
      const fields = sheetFields(sheet(doc));
      expect(new Set(fields).size).toBe(fields.length);
      for (const f of fields) expect(f).toMatch(/^(sheet|cards)\/[a-z0-9.\-/A-Z]+$/u);
    }
    const fields = sheetFields(sheet(level20));
    // Pencil, squares, circles, use boxes of rows and cards, notes, blank lines, the player's name.
    expect(fields).toContain("sheet/primary/stamina");
    expect(fields).toContain("sheet/primary/luck");
    expect(fields).toContain("sheet/recovery/restDice");
    expect(fields.some((f) => /^sheet\/[^/]+\/[^/]+\/uses$/u.test(f))).toBe(true);
    expect(fields.some((f) => /^cards\/[^/]+\/uses$/u.test(f))).toBe(true);
    expect(fields.some((f) => /^sheet\/[^/]+\/notes$/u.test(f))).toBe(true);
    expect(fields.some((f) => /^sheet\/[^/]+\/lines$/u.test(f))).toBe(true);
    expect(fields).toContain("sheet/header/playedBy");
    // A printed number is read, not written: no field.
    const guard = sheet(level20)
      .sections.flatMap((s) => (s.kind === "statBoxes" ? s.boxes : []))
      .find((b) => b.valueId === "guard")!;
    expect(guard.field).toBeUndefined();
  });

  it("keeps a field's id when the character goes up a level", () => {
    const at3 = sheetFields(sheet(level3));
    const at20 = sheetFields(sheet(level20));
    expect(at20.length).toBeGreaterThan(at3.length);
    // Every place of level 3 is still there at level 20, under the same id.
    for (const f of at3) expect(at20, f).toContain(f);
    // Language does not change an id (only the order of rows sorted by name).
    expect(sheetFields(sheet(level20, "en")).sort()).toEqual([...at20].sort());
  });

  it("lists for each value the values that change with it, by their names on the sheet", () => {
    const model = sheet(level20);
    const value = (id: string) => model.values.find((v) => v.id === id)!;
    // grace → graceBonus → guard (6 + graceBonus), and the totals of talents made with it.
    const fromGrace = value("grace").dependents.map((d) => d.id);
    expect(fromGrace).toContain("graceBonus");
    expect(fromGrace).toContain("guard");
    expect(fromGrace.some((id) => id.endsWith("Roll"))).toBe(true);
    for (const d of value("grace").dependents) expect(d.label).not.toBe("");
    expect(value("level").dependents.length).toBeGreaterThan(0);
    // A value nothing is made from has an empty list.
    expect(value("guard").dependents).toEqual([]);
    expect(value("guard").text).not.toBe("");
  });

  it("collects the full texts of every row and card thing, grouped by what brought them", () => {
    const model = sheet(level20);
    const ids = model.rulesTexts.flatMap((g) => g.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of model.cards) expect(ids).toContain(c.id);
    const rows = model.sections.flatMap((s) => (s.kind === "featureTable" ? s.rows : []));
    for (const r of rows) expect(ids).toContain(r.id);
    for (const g of model.rulesTexts) {
      expect(g.title).not.toBe("");
      for (const e of g.entries) expect(e.name).not.toBe("");
    }
    // The demo's cards carry their explanation as the full text.
    const card = model.rulesTexts.flatMap((g) => g.entries).find((e) => e.id === model.cards[0]!.id)!;
    expect(card.explain.length).toBeGreaterThan(0);
    expect(card.kindName).not.toBe("");
    expect(model.rulesTexts.length).toBeGreaterThan(1);
  });

  it("does not depend on the PDF library", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(deps).filter((d) => /pdf/u.test(d))).toEqual([]);
    for (const f of readdirSync(new URL(".", import.meta.url)).filter((f) => !f.endsWith(".test.ts"))) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/from "pdf/u);
    }
  });
});

describe("dependentValues", () => {
  it("follows formulas through other values and counts grants only of things the character has", () => {
    const ev = evaluateDraft(pkg, level3);
    const deps = dependentValues(pkg, ev);
    expect(deps["mightBase"]).toEqual(expect.arrayContaining(["might", "mightBonus"]));
    // In package order, without the value itself.
    const order = pkg.values.map((v) => v.id);
    for (const list of Object.values(deps)) {
      const at = list.map((id) => order.indexOf(id));
      expect(at).toEqual([...at].sort((a, b) => a - b));
    }
    expect(deps["might"]).not.toContain("might");
    // Without any thing, no grant makes a value depend on another.
    const bare = dependentValues(pkg, { things: [], level: ev.level });
    for (const [source, list] of Object.entries(bare))
      expect(deps[source]).toEqual(expect.arrayContaining(list));
  });
});
