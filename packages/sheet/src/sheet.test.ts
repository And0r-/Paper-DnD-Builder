import { evaluateDraft, dependentValues, type DraftDocument } from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, sheetFieldNames, sheetFields, type SheetModel } from "./index.ts";
import { sheetModelSchema } from "./schema.ts";
import { MESSAGES } from "./messages.ts";
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

  it("says where a printed number comes from when a thing adds to it, like a check", () => {
    const box = (m: SheetModel, id: string) =>
      m.sections.flatMap((s) => (s.kind === "statBoxes" ? s.boxes : [])).find((b) => b.valueId === id)!;
    // Guard: 6 to start from, a trait and a shield.
    expect(box(sheet(level3), "guard").parts).toBe("6 · Schützendes Leuchten +1 · Schilfschild +2");
    // Nerve of the level and the scores alone: nothing to take apart on paper.
    expect(box(sheet(level3), "nerve").parts).toBe("");
    // A thing that adds a score's bonus to nerve (like a feature that adds one to a roll) is named.
    const gifted: ContentPackage = structuredClone(pkg);
    const calling = gifted.things.find((t) => t.id === "calling.lantern-bearer")!;
    calling.grants = [...(calling.grants ?? []), { value: "nerve", add: "heartBonus" }];
    const doc = demoCharacter(gifted, 3);
    const model = buildSheetModel(gifted, doc, { language: "en", createdAt });
    expect(box(model, "nerve").parts).toMatch(/ · Lantern Bearer\u00a0\+1$/u);
  });

  it("prints a box's remarks while their condition holds, joined, beside where the number comes from", () => {
    const box = (m: SheetModel, id: string) =>
      m.sections.flatMap((s) => (s.kind === "statBoxes" ? s.boxes : [])).find((b) => b.valueId === id)!;
    // The demo character is not of the folk that stands firm: the guard box says nothing more.
    expect(evaluateDraft(pkg, level3).things.some((t) => t.id === "trait.stone-steady")).toBe(false);
    expect(box(sheet(level3), "guard").remarks).toBeUndefined();
    // Remarks by level: none below it, both together above it; a box without remarks has none.
    const remarked: ContentPackage = structuredClone(pkg);
    const primary = remarked.sheet.sections.find((s) => s.id === "primary")!;
    if (primary.kind !== "statBoxes") throw new Error("primary is a row of boxes");
    primary.boxes.find((b) => b.value === "nerve")!.remarks = [
      { text: "sheet.primary.nerve", when: "level >= 5" },
      { text: "sheet.primary.guard.steady", when: "level >= 10" },
    ];
    const at = (doc: DraftDocument) => buildSheetModel(remarked, doc, { language: "en", createdAt });
    expect(box(at(level3), "nerve").remarks).toBeUndefined();
    expect(box(at(level20), "nerve").remarks).toBe("Nerve · Knocked down? Roll twice.");
    expect(box(at(level20), "pace").remarks).toBeUndefined();
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

  it("names every field as the sheet shows it", () => {
    const model = sheet(level20, "de");
    const names = sheetFieldNames(model);
    expect([...names.keys()].sort()).toEqual(sheetFields(model).sort());
    const stamina = model.sections
      .flatMap((s) => (s.kind === "statBoxes" ? s.boxes : []))
      .find((b) => b.field === "sheet/primary/stamina")!;
    expect(names.get("sheet/primary/stamina")).toBe(stamina.label);
    expect(names.get("sheet/header/playedBy")).toBe("Gespielt von");
    for (const name of names.values()) expect(name).not.toBe("");
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

  it("names as depending only values the sheet shows: not those of a weapon the character does not hold", () => {
    const ev = evaluateDraft(pkg, level20);
    const model = buildSheetModel(pkg, level20, { language: "de", createdAt }, ev);
    const all = dependentValues(pkg, ev);
    const named = (id: string) => model.values.find((v) => v.id === id)!.dependents.map((d) => d.id);
    // The formulas make a sling hit from grace; this character holds no sling, so the sheet has no place for it.
    expect(ev.things.some((t) => t.id === "item.sling")).toBe(false);
    expect(all["grace"]).toContain("slingHit");
    expect(named("grace")).not.toContain("slingHit");
    // A held weapon's hit (a cell) and harm (a text filled with it) stay.
    expect(named("might")).toEqual(expect.arrayContaining(["lanternStaffHit", "lanternStaffHarm"]));
    for (const v of model.values) for (const d of v.dependents) expect(all[v.id]).toContain(d.id);
  });

  it("ticks a talent every character has without a pick (flow.grants, format 0.17)", () => {
    const talents = sheet(level3).sections.find((s) => s.id === "talents")!;
    const item =
      talents.kind === "checkList" ? talents.items.find((i) => i.id === "talent.mist-signs") : undefined;
    expect(item).toMatchObject({ name: "Nebelzeichen", marked: true });
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

  it("puts on each card the line of the first origin its thing matches (format 0.16)", () => {
    // A herbalist borrows a knack of another calling at level 2: that one goes by other numbers.
    // Fixed numbers here, so the borrowed line cannot be mistaken for the calling's.
    const fixed: ContentPackage = {
      ...pkg,
      values: pkg.values.map((v) =>
        v.id === "borrowedKnackTarget"
          ? { ...v, formula: "21" }
          : v.id === "borrowedKnackHit"
            ? { ...v, formula: "-1" }
            : v,
      ),
    };
    const doc = demoCharacter(fixed, 3, "Mira Fennwick", "calling.herbalist");
    const ev = evaluateDraft(fixed, doc);
    const borrowed = ev.things.filter((h) => h.pickedIn === "borrowed-knack").map((h) => h.id);
    expect(borrowed).toHaveLength(1);
    const cards = (p: ContentPackage) => buildSheetModel(p, doc, { language: "de", createdAt }).cards;
    const own = `Ziel ${ev.values["knackTarget"]} · Treffer +${ev.values["knackHit"]}`;
    for (const c of cards(fixed)) {
      // The borrowed knack also came with the calling (its choice did); the entry before wins.
      if (borrowed.includes(c.id))
        expect(c.origin).toEqual({ label: "Geliehen, mit Herz", value: "Ziel 21 · Treffer -1" });
      // A path's knack is labelled with what brought it in the end: the calling.
      else expect(c.origin).toEqual({ label: "Kräuterkundige", value: own });
    }

    // The order of the entries decides: the calling's first, and the borrowed knack goes by the calling too.
    const layout = fixed.sheet.cards["knack"]!;
    const reordered: ContentPackage = {
      ...fixed,
      sheet: {
        ...fixed.sheet,
        cards: { knack: { ...layout, origins: [...layout.origins!.slice(1), layout.origins![0]!] } },
      },
    };
    expect(cards(reordered).find((c) => c.id === borrowed[0])?.origin).toEqual({
      label: "Kräuterkundige",
      value: own,
    });

    // No entry matches, no line; no entries at all, neither.
    const pathOnly = { ...layout, origins: [layout.origins![2]!] };
    const onlyPath = cards({ ...fixed, sheet: { ...fixed.sheet, cards: { knack: pathOnly } } });
    const fromPath = ev.things
      .filter((h) => h.kind === "knack" && h.grantedBy?.startsWith("path."))
      .map((h) => h.id);
    expect(fromPath).toHaveLength(1);
    expect(onlyPath.filter((c) => c.origin !== undefined).map((c) => c.id)).toEqual(fromPath);
    const { origins: _, ...plain } = layout;
    expect(
      cards({ ...fixed, sheet: { ...fixed.sheet, cards: { knack: plain } } }).some((c) => "origin" in c),
    ).toBe(false);
  });

  it("prints a line under a list entry that has the detail text, once for a counted thing (format 0.22)", () => {
    const gear = (m: SheetModel) => {
      const s = m.sections.find((x) => x.id === "gear");
      if (s?.kind !== "list") throw new Error("no gear list");
      return s;
    };
    const herbalist = demoCharacter(pkg, 3, "Mira Fennwick", "calling.herbalist");
    const de = gear(sheet(herbalist));
    const satchel = de.items.indexOf("Kräutertasche");
    expect(satchel).toBeGreaterThanOrEqual(0);
    expect(de.details).toHaveLength(de.items.length);
    // The length follows the reader's units: German starts in metres, English in feet.
    expect(de.details![satchel]).toBe(
      "Getrocknetes Nebelblatt, eine Knochennadel, 3 Meter Schilffaden, 3 kleine Tontöpfe.",
    );
    expect(de.details!.filter((d) => d !== "")).toHaveLength(1);
    expect(gear(sheet(herbalist, "en")).details).toContain(
      "Dried mistleaf, a bone needle, 10 feet of reed thread, 3 small clay jars.",
    );

    // Two of them: the line says what one holds, under the counted name.
    const twice: ContentPackage = {
      ...pkg,
      things: pkg.things.map((t) =>
        t.id === "calling.herbalist"
          ? {
              ...t,
              grants: t.grants!.map((g) =>
                "thing" in g && g.thing === "item.herb-satchel" ? { ...g, count: 2 } : g,
              ),
            }
          : t,
      ),
    };
    const counted = gear(buildSheetModel(twice, herbalist, { language: "de", createdAt }));
    const at = counted.items.indexOf("2 × Kräutertasche");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(counted.details![at]).toBe(de.details![satchel]);

    // No listed thing with the text, or no detail on the section: no lines at all, as before 0.22.
    expect(gear(sheet(level3))).not.toHaveProperty("details");
    const plain: ContentPackage = {
      ...pkg,
      sheet: {
        ...pkg.sheet,
        sections: pkg.sheet.sections.map((x) => (x.kind === "list" ? { ...x, detail: undefined } : x)),
      },
    };
    expect(gear(buildSheetModel(plain, herbalist, { language: "de", createdAt }))).not.toHaveProperty(
      "details",
    );
  });

  it("accepts a stored copy from before format 0.22, without lines under list entries", () => {
    const model = sheet(demoCharacter(pkg, 3, "Mira Fennwick", "calling.herbalist"));
    const old = {
      ...model,
      sections: model.sections.map((s) => {
        if (s.kind !== "list") return s;
        const { details: _, ...rest } = s;
        return rest;
      }),
    };
    expect(sheetModelSchema.safeParse(JSON.parse(JSON.stringify(old))).success).toBe(true);
  });

  it("says on the row of the thing that brought it that a choice had nothing to pick", () => {
    // A river runner has neither Legends nor Mending: Keen Study finds nothing to study.
    const runner = demoCharacter(pkg, 4, "Mira Fennwick", "calling.river-runner");
    const doc = { ...runner, answers: { ...runner.answers, "boon-4": { pick: "boon.keen-study" } } };
    expect(evaluateDraft(pkg, doc).complete).toBe(true);
    for (const language of ["de", "en"]) {
      const rows = sheet(doc, language).sections.flatMap((s) => (s.kind === "featureTable" ? s.rows : []));
      expect(rows.find((r) => r.id === "trait.keen-study")?.note).toBe(MESSAGES[language]!.nothingToChoose);
      expect(rows.filter((r) => r.note === MESSAGES[language]!.nothingToChoose)).toHaveLength(1);
    }
    // A section of answers that lists the choice says the same as its answer.
    const listed = structuredClone(pkg);
    listed.sheet.sections.push({ id: "study", kind: "answers", span: 4, choices: ["keen-study"] });
    const answers = buildSheetModel(listed, doc, { language: "en", createdAt }).sections.find(
      (s) => s.id === "study",
    );
    expect(answers?.kind === "answers" && answers.rows).toEqual([
      { label: "Studied talent", text: MESSAGES["en"]!.nothingToChoose },
    ]);
  });

  it("writes the texts of a pick after the thing's name, in the table and in a section of answers", () => {
    const herbalist = demoCharacter(pkg, 1, "Mira Fennwick", "calling.herbalist");
    const texts = { "trait.far-lore": { first: "Salzmarschen", second: "Glut-Hügel" } };
    const doc = {
      ...herbalist,
      answers: { ...herbalist.answers, "herb-craft": { pick: "trait.far-lore", texts } },
    };
    expect(evaluateDraft(pkg, doc).complete).toBe(true);
    const listed = structuredClone(pkg);
    listed.sheet.sections.push({ id: "craft", kind: "answers", span: 4, choices: ["herb-craft"] });
    const model = buildSheetModel(listed, doc, { language: "de", createdAt });
    const rows = model.sections.flatMap((s) => (s.kind === "featureTable" ? s.rows : []));
    expect(rows.find((r) => r.id === "trait.far-lore")?.name).toBe("Fernkunde (Salzmarschen, Glut-Hügel)");
    const answers = model.sections.find((s) => s.id === "craft");
    expect(answers?.kind === "answers" && answers.rows[0]?.text).toBe("Fernkunde (Salzmarschen, Glut-Hügel)");
    // Another pick: its texts stay in the answer for going back, the sheet names only what counts.
    const leaf = { ...doc, answers: { ...doc.answers, "herb-craft": { pick: "trait.leaf-lore", texts } } };
    const leafRows = sheet(leaf).sections.flatMap((s) => (s.kind === "featureTable" ? s.rows : []));
    expect(leafRows.find((r) => r.id === "trait.leaf-lore")?.name).toBe("Blattkunde");
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
