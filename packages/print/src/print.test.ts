import type { DraftDocument } from "@builder/core";
import { applyChange, evaluateDraft } from "@builder/core";
import type { ContentPackage, TextValue } from "@builder/format";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { cardCount } from "./cards.ts";
import { MESSAGES } from "./messages.ts";
import { buildPrintModel, firstSentence, PrintError, type PrintModel, type SheetSection } from "./model.ts";
import { renderPdf, type RenderedPdf } from "./render.ts";
import { demoCharacter, loadDemoPackage, raisedCharacter } from "./testing.ts";

let pkg: ContentPackage;
let doc: DraftDocument;
const createdAt = new Date("2026-10-04T12:00:00Z");

interface Extracted {
  pages: number;
  text: string;
  /** Text per page. */
  pageTexts: string[];
  /** Smallest font size used for any text, in points. */
  minFontSize: number;
  title: string;
}

async function extract(pdf: RenderedPdf): Promise<Extracted> {
  const task = getDocument({ data: pdf.bytes.slice(), verbosity: 0 });
  const loaded = await task.promise;
  const pageTexts: string[] = [];
  let minFontSize = Infinity;
  for (let i = 1; i <= loaded.numPages; i++) {
    const content = await (await loaded.getPage(i)).getTextContent();
    const items = content.items.filter((it) => "str" in it);
    for (const it of items) {
      if (it.str.trim() === "") continue;
      const [a, b] = it.transform as number[];
      minFontSize = Math.min(minFontSize, Math.hypot(a!, b!));
    }
    pageTexts.push(items.map((it) => it.str).join(" "));
  }
  const info = (await loaded.getMetadata()).info as { Title?: string };
  await task.destroy();
  return {
    pages: loaded.numPages,
    text: pageTexts.join("\n"),
    pageTexts,
    minFontSize,
    title: info.Title ?? "",
  };
}

const PT = 72 / 25.4;

interface Placed {
  str: string;
  /** Left edge and baseline, in mm from the top left corner of the page. */
  x: number;
  y: number;
  /** Width in mm. */
  w: number;
}

/** Every piece of text with its place on the page, per page. */
async function positions(pdf: RenderedPdf): Promise<Placed[][]> {
  const task = getDocument({ data: pdf.bytes.slice(), verbosity: 0 });
  const loaded = await task.promise;
  const pages: Placed[][] = [];
  for (let i = 1; i <= loaded.numPages; i++) {
    const page = await loaded.getPage(i);
    const height = page.view[3]!;
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((it) => "str" in it && it.str.trim() !== "")
        .map((it) => {
          const t = it as { str: string; transform: number[]; width: number };
          return { str: t.str, x: t.transform[4]! / PT, y: (height - t.transform[5]!) / PT, w: t.width / PT };
        }),
    );
  }
  await task.destroy();
  return pages;
}

async function print(language: string, units: Record<string, string>, p = pkg, d = doc) {
  const model = buildPrintModel(p, d, { language, units, createdAt });
  const pdf = await renderPdf(model);
  return { model, pdf, extracted: await extract(pdf) };
}

/** Words (4+ letters) in a set of texts, without placeholders and glossary markup. */
function words(values: Iterable<TextValue | string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    if (v === null) continue;
    for (const s of Array.isArray(v) ? v : [v]) {
      const plain = s.replace(/\{\{[^}]*\}\}/g, " ").replace(/\[\[glossary:[^|\]]*\|([^\]]*)\]\]/g, "$1");
      for (const w of plain.match(/\p{L}{4,}/gu) ?? []) out.add(w.toLowerCase());
    }
  }
  return out;
}

function messageWords(language: string): Set<string> {
  const m = MESSAGES[language]!;
  const { startValue, page, unitsUsed, createdOn, ...plain } = m;
  return words([...Object.values(plain), startValue(""), page(1, 2), unitsUsed([]), createdOn("")]);
}

/** Words that only the other language uses: none of them may appear in a document. */
function foreignWords(language: string, other: string): Set<string> {
  const own = new Set([...words(Object.values(pkg.texts[language]!)), ...messageWords(language)]);
  const foreign = new Set([...words(Object.values(pkg.texts[other]!)), ...messageWords(other)]);
  for (const w of own) foreign.delete(w);
  // The character's name is the player's own text, the same in every language.
  for (const w of words(["Mira Fennwick"])) foreign.delete(w);
  return foreign;
}

beforeAll(async () => {
  pkg = await loadDemoPackage();
  doc = demoCharacter(pkg, 3);
});

describe("printed character (demo package)", () => {
  it("German with meters: sheet and cards, all text extractable, nothing in English", async () => {
    const { model, pdf, extracted } = await print("de", { length: "m", weight: "kg" });
    const ev = evaluateDraft(pkg, doc);
    const cardThings = ev.things.filter((h) => pkg.things.find((t) => t.id === h.id)?.card);
    expect(cardThings.length).toBeGreaterThan(0);
    expect(model.cards).toHaveLength(cardThings.length);
    // The done screen asks the same question before offering cards.
    expect(cardCount(pkg, ev)).toBe(model.cards.length);
    const noCards = { ...pkg, things: pkg.things.map((t) => ({ ...t, card: false })) };
    expect(cardCount(noCards, ev)).toBe(0);

    // Sheet pages first, then one page per nine cards.
    expect(pdf.cardPages).toBe(Math.ceil(cardThings.length / 9));
    expect(extracted.pages).toBe(pdf.pages);
    expect(extracted.pages).toBe(pdf.sheetPages + pdf.cardPages);
    expect(pdf.sheetPages).toBe(2);
    expect(extracted.pages).toBe(3);

    const t = extracted.text;
    expect(t).toContain("Mira Fennwick");
    expect(t).toContain("Laternenträgerin · Stufe 3");
    for (const c of model.cards) expect(t).toContain(c.name);
    expect(t).toContain("7,5 m"); // pace: 25 ft by the package's table, not 7,62 m
    expect(t).toContain("Einheiten: Meter, Kilogramm");
    expect(t).toContain("Seite 1 von 3");
    expect(extracted.pageTexts[2]).toContain("In Originalgrösse (100 %) drucken.");
    // License line on the last page.
    expect(extracted.pageTexts.at(-1)).toContain("Lizenz: GNU AGPL 3.0");

    const foreign = foreignWords("de", "en");
    expect(foreign.size).toBeGreaterThan(100);
    const found = [...words([t])].filter((w) => foreign.has(w));
    expect(found).toEqual([]);
    expect(t).not.toMatch(/\d\s?(ft|Fuss|feet|lb|Pfd\.|Pfund)\b/u);
  });

  it("English with feet: the same character, nothing in German", async () => {
    const { pdf, extracted } = await print("en", { length: "ft", weight: "lb" });
    expect(extracted.pages).toBe(pdf.sheetPages + pdf.cardPages);
    const t = extracted.text;
    expect(t).toContain("Lantern Bearer · Level 3");
    expect(t).toContain("25 ft");
    expect(t).toContain("Units: feet, pounds");
    const foreign = foreignWords("en", "de");
    expect(foreign.size).toBeGreaterThan(100);
    const found = [...words([t])].filter((w) => foreign.has(w));
    expect(found).toEqual([]);
    expect(t).not.toMatch(/\d\s?(m|meters|kg)\b/u);
  });

  it("units follow the setting, not the language", async () => {
    const { extracted } = await print("de", { length: "ft", weight: "lb" });
    expect(extracted.text).toContain("25 Fuss");
    expect(extracted.text).not.toMatch(/\d\s?m\b/u);
  });

  it("never prints below 7 pt", async () => {
    const { extracted } = await print("de", {});
    expect(extracted.minFontSize).toBeGreaterThanOrEqual(6.99);
  });

  it("is a self-contained PDF/A: embedded font, title, no links, forms or scripts", async () => {
    const { pdf, extracted } = await print("en", {});
    expect(extracted.title).toBe("Mira Fennwick");
    const raw = Buffer.from(pdf.bytes).toString("latin1");
    expect(raw.startsWith("%PDF-1.7")).toBe(true);
    expect(raw).toContain("/FontFile2");
    expect(raw).toContain("pdfaid:part");
    for (const bad of ["/URI", "/JavaScript", "/JS ", "/AcroForm", "/Annots", "/Launch", "/Helvetica"])
      expect(raw).not.toContain(bad);
  });

  it("puts a rules text that does not fit on a continuation card, without cutting it", async () => {
    const first = demoCardThing();
    const long = Array.from(
      { length: 40 },
      (_, i) => `Satz ${i + 1}: Die Laterne flackert, und der Nebel weicht zurück.`,
    ).join(" ");
    const texts: Record<string, Record<string, TextValue>> = {
      ...pkg.texts,
      de: { ...pkg.texts["de"]!, [`${first}.rules`]: `${long} Ende.` },
    };
    const withRules: ContentPackage = { ...pkg, texts };
    const { pdf, extracted } = await print("de", {}, withRules);
    const cards = extracted.pageTexts.slice(pdf.sheetPages).join("\n");
    expect(cards).toContain("REGELTEXT");
    expect(cards).toContain("weiter auf der nächsten Karte");
    expect(cards).toContain("FORTSETZUNG");
    expect(cards).toMatch(/\(2\/\d\)/u);
    // Every sentence made it onto a card, the last one included.
    expect(cards).toContain("Satz 40:");
    expect(cards).toContain("Ende.");
  });

  it("gives notes the whole page when they end the sheet alone on a new page", async () => {
    // Level 1: the level-3 "path" section is left out (`when`), so notes end up alone
    // on a sheet without the sections for higher levels.
    const level1 = demoCharacter(pkg, 1);
    // A few more blank gear lines fill the first page, so only the notes move on.
    const lower = new Set(["rolls", "lantern-slots", "lantern-slots-high", "attacks"]);
    const early = {
      ...pkg,
      sheet: {
        ...pkg.sheet,
        sections: pkg.sheet.sections
          .filter((s) => !lower.has(s.id))
          .map((s) => (s.id === "gear" && s.kind === "list" ? { ...s, blankLines: s.blankLines + 3 } : s)),
      },
    };
    const { pdf } = await print("de", {}, early, level1);
    const last = pdf.sheetLayout.at(-1)!;
    expect(last.map((p) => p.section.id)).toEqual(["notes"]);
    const notes = last[0]!;
    expect(notes.w).toBeCloseTo(186);
    // Lines 6 mm apart down to the footer (A4: 297 mm, footer line about 15 mm above the edge).
    expect(notes.section.kind === "notes" && notes.section.lines).toBeGreaterThan(35);

    // With room on the first page, notes keep their width and shrink to the space left.
    const short = {
      ...early,
      sheet: { ...early.sheet, sections: early.sheet.sections.filter((s) => s.id !== "gear") },
    };
    const { pdf: onePage } = await print("de", {}, short, level1);
    expect(onePage.sheetPages).toBe(1);
    const placed = onePage.sheetLayout[0]!.find((p) => p.section.id === "notes")!;
    expect(placed.w).toBeLessThan(100);
  });

  it("prints use boxes and check list notes from the stats the package names", async () => {
    const { model, extracted } = await print("de", {});
    const byId = (id: string) => model.sections.find((s) => s.id === id)!;
    const knacks = byId("knacks");
    const talents = byId("talents");
    if (knacks.kind !== "featureTable" || talents.kind !== "checkList") throw new Error("demo sheet changed");
    for (const row of knacks.rows) expect(row.uses).toMatchObject({ boxes: expect.any(Number) });
    for (const card of model.cards) expect(card.uses).toMatchObject({ boxes: expect.any(Number) });
    expect(knacks.hint).toContain("□");
    expect(talents.items.every((i) => i.note !== "")).toBe(true);
    expect(extracted.text).toContain(talents.items[0]!.note);
    expect(extracted.text).toContain(pkg.texts["de"]!["stat-value.always"]);

    // A legend for boxes is only printed where there are boxes (print layout 2.1).
    const noUses: ContentPackage = {
      ...pkg,
      things: pkg.things.map((t) => (t.kind === "knack" ? { ...t, stats: { ...t.stats, uses: 0 } } : t)),
    };
    const plain = buildPrintModel(noUses, doc, { language: "de", createdAt });
    const plainKnacks = plain.sections.find((s) => s.id === "knacks")!;
    expect(plainKnacks.hint).toBe("");
    expect(plain.cards.every((c) => c.uses === null)).toBe(true);
  });

  it("prints an attack table and the talent totals, worked out by the package's values", async () => {
    // River runner, level 3: might 9 (bonus 1), grace 12 (bonus 2), practice 2.
    // Boat hook: the better of might and grace bonus (2) + practice 2 = +4, harm 1d4 + 2.
    // Sling: grace bonus 2 + practice 2 = +4, harm 1d4 + 2, range 30/120 ft.
    const r = applyChange(pkg, demoCharacter(pkg, 3, "Mira Fennwick", "calling.river-runner"), {
      type: "answer",
      choice: "gear",
      answer: { pick: "item.sling" },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const attacks = (language: string, units: Record<string, string>) => {
      const model = buildPrintModel(pkg, r.doc, { language, units, createdAt });
      const s = model.sections.find((x) => x.id === "attacks")!;
      if (s.kind !== "statTable") throw new Error("demo sheet changed");
      return { model, s };
    };
    const de = attacks("de", { length: "m" });
    expect(de.s.title).toBe("Angriffe");
    expect(de.s.hint).toBe("Zum Treffen: 2W6 + diese Zahl. Schaden: diese Würfel.");
    expect(de.s.columns).toEqual(["Treffer", "Schaden", "Reichweite"]);
    expect(de.s.rows).toEqual([
      {
        name: "Bootshaken",
        cells: [
          { text: "+4", parts: "Geschick-Bonus +2 · Übung +2" },
          { text: "1W4 +2, spitz", parts: "" },
          { text: "—", parts: "" },
        ],
      },
      {
        name: "Schleuder",
        cells: [
          { text: "+4", parts: "Geschick-Bonus +2 · Übung +2" },
          { text: "1W4 +2, stumpf", parts: "" },
          { text: "9 m / 36 m", parts: "" },
        ],
      },
    ]);
    const en = attacks("en", { length: "ft" });
    expect(en.s.rows.map((row) => row.cells.map((c) => c.text))).toEqual([
      ["+4", "1d4 +2, pointed", "—"],
      ["+4", "1d4 +2, blunt", "30 ft / 120 ft"],
    ]);

    // Talents: the total is in the box, trained or not; where it comes from is under the name.
    const talents = de.model.sections.find((x) => x.id === "talents")!;
    if (talents.kind !== "checkList") throw new Error("demo sheet changed");
    const talent = (name: string) => talents.items.find((i) => i.name === name)!;
    expect(talent("Schleichen")).toMatchObject({ marked: true, total: { text: "+4" } }); // grace 2 + practice 2
    expect(talent("Schleichen").total.parts).toBe("Geschick-Bonus +2 · Übung +2");
    expect(talent("Sagenkunde")).toMatchObject({ marked: false, total: { text: "+0", parts: "" } });
    expect(talents.hint).not.toContain("2");

    // On paper: one table on the first page, two rows, the numbers in it.
    const pdf = await renderPdf(de.model);
    const first = (await extract(pdf)).pageTexts[0]!;
    for (const word of [
      "ANGRIFFE",
      "Bootshaken",
      "Schleuder",
      "1W4 +2, spitz",
      "9 m / 36 m",
      "Geschick-Bonus +2 · Übung +2",
    ])
      expect(first).toContain(word);
    const placed = pdf.sheetLayout[0]!.find((p) => p.section.id === "attacks")!;
    expect(placed.section.kind === "statTable" && placed.section.rows).toHaveLength(2);
  });

  it("prints use boxes from a value that grows, and the picks among what the character has", async () => {
    const traitRow = (model: ReturnType<typeof buildPrintModel>, thing: string) => {
      const traits = model.sections.find((s) => s.id === "traits")!;
      if (traits.kind !== "featureTable") throw new Error("demo sheet changed");
      return traits.rows.find((r) => r.name === pkg.texts["de"]![`${thing}.name`])!;
    };
    // Bloom ward: 2 uses from level 11, 3 from level 17 (value bloomWardUses).
    for (const [level, boxes] of [
      [11, 2],
      [17, 3],
    ] as const) {
      const herbalist = demoCharacter(pkg, level, "Mira Fennwick", "calling.herbalist");
      const model = buildPrintModel(pkg, herbalist, { language: "de", createdAt });
      expect(traitRow(model, "trait.bloom-ward").uses).toEqual({ boxes });
    }
    // River heart: as often as practice, 6 at level 20.
    const runner = demoCharacter(pkg, 20, "Mira Fennwick", "calling.river-runner");
    const runnerModel = buildPrintModel(pkg, runner, { language: "de", createdAt });
    expect(traitRow(runnerModel, "trait.river-heart").uses).toEqual({ boxes: 6 });

    // Favourite knacks (level 18, options.owned): printed by name in their answers section.
    const bearer = demoCharacter(pkg, 18);
    const ev = evaluateDraft(pkg, bearer);
    const picks = (ev.choices["lantern-mastery"]!.answer as { picks: string[] }).picks;
    const { model, extracted } = await print("de", {}, pkg, bearer);
    const mastery = model.sections.find((s) => s.id === "mastery")!;
    if (mastery.kind !== "answers") throw new Error("demo sheet changed");
    const names = picks.map((p) => pkg.texts["de"]![`${p}.name`] as string);
    expect(mastery.rows).toEqual([
      { label: pkg.texts["de"]!["choice.lantern-mastery.title"], text: names.join(", ") },
    ]);
    for (const n of names) expect(extracted.text).toContain(n);
  });

  it("leaves out sections and boxes whose `when` is false; the rest moves up", async () => {
    const title = pkg.texts["de"]!["sheet.path.title"] as string;
    const pathShort = pkg.texts["de"]!["path.lightwarden.short"] as string;

    // Level 3: "level >= 3" holds, the section is on the sheet.
    const { model, pdf, extracted } = await print("de", {});
    expect(model.sections.map((s) => s.id)).toContain("path");
    expect(pdf.sheetLayout.flat().map((p) => p.section.id)).toContain("path");
    expect(extracted.text).toContain(pathShort);

    // Level 2: no section, no title, no empty frame; every other section still placed.
    // The high lantern slots are not printed either: all their boxes are 0 (`when` on each box).
    const level2 = demoCharacter(pkg, 2);
    const low = await print("de", {}, pkg, level2);
    const ids = pkg.sheet.sections
      .map((s) => s.id)
      .filter((id) => id !== "path" && id !== "lantern-slots-high" && id !== "mastery");
    expect(low.model.sections.map((s) => s.id)).toEqual(ids);
    expect(low.pdf.sheetLayout.flat().map((p) => p.section.id)).toEqual(ids);
    expect(low.extracted.pageTexts.slice(0, low.pdf.sheetPages).join("\n")).not.toContain(title);

    // Boxes: a false `when` drops the box, its row keeps the others; all gone drops the row.
    const withBoxWhen = (when: (value: string) => string | undefined): ContentPackage => ({
      ...pkg,
      sheet: {
        ...pkg.sheet,
        sections: pkg.sheet.sections.map((s) =>
          s.kind === "statBoxes"
            ? {
                ...s,
                boxes: s.boxes.map((b) => ({ ...b, ...(when(b.value) ? { when: when(b.value)! } : {}) })),
              }
            : s,
        ),
      },
    });
    const noLuck = buildPrintModel(
      withBoxWhen((v) => (v === "luck" ? "luck > 99" : undefined)),
      doc,
      { language: "de", createdAt },
    );
    const primary = noLuck.sections.find((s) => s.id === "primary")!;
    if (primary.kind !== "statBoxes") throw new Error("demo sheet changed");
    expect(primary.boxes.map((b) => b.label)).not.toContain(pkg.texts["de"]!["value.luck.name"]);
    expect(primary.boxes).toHaveLength(5);
    const none = buildPrintModel(
      withBoxWhen(() => "level > 99"),
      doc,
      { language: "de", createdAt },
    );
    expect(none.sections.map((s) => s.id)).not.toContain("primary");
  });

  it("prints a level-20 character: every slot rank above 0, cards over several pages", async () => {
    // Lantern bearer: slots of ranks 1 to 9, in a row of 5 and a row of 4.
    const lantern = demoCharacter(pkg, 20);
    const { model, pdf, extracted } = await print("de", {}, pkg, lantern);
    const boxes = (id: string) => {
      const s = model.sections.find((x) => x.id === id);
      if (s?.kind !== "statBoxes") throw new Error(`no box row ${id}`);
      return s.boxes.map((b) => [b.label, b.circles]);
    };
    expect(boxes("lantern-slots")).toEqual([
      ["Rang 1", 3],
      ["Rang 2", 2],
      ["Rang 3", 2],
      ["Rang 4", 2],
      ["Rang 5", 2],
    ]);
    expect(boxes("lantern-slots-high")).toEqual([
      ["Rang 6", 2],
      ["Rang 7", 1],
      ["Rang 8", 1],
      ["Rang 9", 2],
    ]);
    const sheet = extracted.pageTexts.slice(0, pdf.sheetPages).join("\n");
    expect(sheet).toContain("LATERNEN-PLÄTZE, HOHE RÄNGE");

    // At level 5 only ranks 1 to 3 have slots; the high row is not printed at all.
    const low = buildPrintModel(pkg, demoCharacter(pkg, 5), { language: "de", createdAt });
    const row = low.sections.find((x) => x.id === "lantern-slots");
    expect(row?.kind === "statBoxes" && row.boxes.map((b) => b.label)).toEqual([
      "Rang 1",
      "Rang 2",
      "Rang 3",
    ]);
    expect(low.sections.map((x) => x.id)).not.toContain("lantern-slots-high");

    // Herbalist: 8 root knacks, a borrowed one and the path's: 10 cards, two card pages.
    const h = await print("de", {}, pkg, demoCharacter(pkg, 20, "Mira Fennwick", "calling.herbalist"));
    expect(h.model.cards.length).toBe(10);
    expect(h.pdf.cardPages).toBe(2);
    expect(h.pdf.pages).toBe(h.pdf.sheetPages + 2);
  });

  it("prints a raised character at its new level: 1 → 2 → 3 → 5, and 1 → 20 in one go", async () => {
    const l1 = demoCharacter(pkg, 1);
    const l2 = raisedCharacter(pkg, l1, 2);
    const l3 = raisedCharacter(pkg, l2, 3);
    const l5 = raisedCharacter(pkg, l3, 5);
    const l20 = raisedCharacter(pkg, l1, 20);
    const boxes = (model: PrintModel, id: string) => {
      const s = model.sections.find((x) => x.id === id);
      if (s?.kind !== "statBoxes") return [];
      return s.boxes.map((b) => (b.style === "circles" ? b.circles : b.text));
    };
    // Primary row: stamina, guard, pace, luck, nerve, practice; worked out by hand:
    // stamina 8 + 5 (level 2) + 5 (level 3) + 5 per level from 4; guard 6 + shield 2 + the path's glow 1;
    // luck min(3, 1 + heart bonus); nerve 1 + floor(level / 2) + heart bonus; practice by table.
    // Heart 11 (bonus 1), 13 from boon 4 on (bonus 2), 15 from boon 8 on (bonus 3).
    // Cards: the knacks of the level's table (3, 3, 4, 8) and, from level 3, the path's own knack.
    const expected = [
      { doc: l2, level: 2, primary: ["13", "8", "7,5 m", 2, "3", "2"], slots: [2], cards: 3 },
      { doc: l3, level: 3, primary: ["18", "9", "7,5 m", 2, "3", "2"], slots: [2, 1], cards: 4 },
      { doc: l5, level: 5, primary: ["28", "9", "7,5 m", 3, "5", "3"], slots: [3, 2, 1], cards: 5 },
      { doc: l20, level: 20, primary: ["103", "9", "7,5 m", 3, "14", "6"], slots: [3, 2, 2, 2, 2], cards: 9 },
    ];
    for (const e of expected) {
      const { model, pdf, extracted } = await print("de", {}, pkg, e.doc);
      expect(model.levelLabel, `level ${e.level}`).toBe(`Stufe ${e.level}`);
      expect(extracted.text).toContain(`Laternenträgerin · Stufe ${e.level}`);
      expect(boxes(model, "primary"), `level ${e.level}`).toEqual(e.primary);
      expect(boxes(model, "lantern-slots"), `level ${e.level}`).toEqual(e.slots);
      expect(model.cards.length, `level ${e.level}`).toBe(cardCount(pkg, evaluateDraft(pkg, e.doc)));
      expect(model.cards.length, `level ${e.level}`).toBe(e.cards);
      expect(extracted.pages).toBe(pdf.sheetPages + pdf.cardPages);
    }
    // The cards of level 1 are still there after every raise.
    const first = buildPrintModel(pkg, l1, { language: "de", createdAt }).cards.map((c) => c.name);
    for (const e of expected) {
      const names = buildPrintModel(pkg, e.doc, { language: "de", createdAt }).cards.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(first));
    }
    // The same character raised in one go or built at 20 prints the same numbers.
    const built = buildPrintModel(pkg, demoCharacter(pkg, 20), { language: "de", createdAt });
    const raised = buildPrintModel(pkg, l20, { language: "de", createdAt });
    expect(boxes(raised, "primary")).toEqual(boxes(built, "primary"));
    expect(boxes(raised, "lantern-slots-high")).toEqual(boxes(built, "lantern-slots-high"));
  });

  it("goes on on the next page with a section longer than a page, for every kind of rows", async () => {
    const model = buildPrintModel(pkg, doc, { language: "de", createdAt });
    const n = 45;
    const names = (prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
    const base = { span: 4, hint: "Hinweis am Ende" };
    const long: SheetSection[] = [
      {
        ...base,
        id: "long-scores",
        kind: "scoreColumn",
        title: "Werte",
        scores: names("Wert").map((label) => ({ label, value: "3", derivedLabel: "", derived: null })),
      },
      {
        ...base,
        id: "long-checks",
        kind: "checkList",
        title: "Haken",
        items: names("Haken").map((name) => ({
          name,
          marked: false,
          note: "",
          total: { text: "", parts: "" },
        })),
      },
      {
        ...base,
        id: "long-stat-table",
        kind: "statTable",
        title: "Spalten",
        columns: ["Zahl", "Text"],
        rows: names("Reihe").map((name) => ({
          name,
          cells: [
            { text: "+3", parts: "Anmut +1 · Übung +2" },
            { text: "ein Text", parts: "" },
          ],
        })),
      },
      {
        ...base,
        id: "long-table",
        kind: "featureTable",
        title: "Tabelle",
        rows: names("Zeile").map((name) => ({ name, text: "Ein kurzer Text.", uses: null })),
      },
      { ...base, id: "long-list", kind: "list", title: "Liste", items: names("Ding"), blankLines: 3 },
    ];
    const withLong: PrintModel = { ...model, sections: [...model.sections.slice(0, 3), ...long] };
    const pdf = await renderPdf(withLong);
    const pages = await positions(pdf);
    const sheet = pages.slice(0, pdf.sheetPages);
    const all = sheet.flat().map((p) => p.str);
    // Nothing is dropped: every row of every section is printed.
    for (const prefix of ["Wert", "Haken", "Zeile", "Ding"])
      for (const name of names(prefix)) expect(all).toContain(name);
    expect(all.join(" ")).toContain("WERTE (FORTSETZUNG)");
    // The hint is printed once, under the last part.
    expect(all.filter((s) => s === "Hinweis am Ende")).toHaveLength(long.length);
    // And nothing runs into the footer (its line is 16 mm above the bottom edge).
    for (const page of sheet)
      for (const item of page.filter((p) => /^(Wert|Haken|Zeile|Ding) \d+$/u.test(p.str)))
        expect(item.y).toBeLessThan(297 - 16);
  });

  it("ends a hint after its first sentence, not at an ordinal number", async () => {
    expect(firstSentence("So oft darfst du Kniffe des 1. Grades nutzen. Danach rastest du.", "de")).toBe(
      "So oft darfst du Kniffe des 1. Grades nutzen.",
    );
    expect(firstSentence("Siehe z. B. die Laterne. Mehr.", "de")).toBe("Siehe z. B. die Laterne.");
    expect(firstSentence("Uses of rank 1. Then rest.", "en")).toBe("Uses of rank 1.");

    const texts: Record<string, Record<string, TextValue>> = {
      ...pkg.texts,
      de: {
        ...pkg.texts["de"]!,
        "value.guard.explain": "Das schützt dich bis zum 2. Treffer. Danach nicht.",
      },
    };
    const { model, extracted } = await print("de", {}, { ...pkg, texts });
    const primary = model.sections.find((s) => s.id === "primary");
    if (primary?.kind !== "statBoxes") throw new Error("demo sheet changed");
    expect(primary.boxes.find((b) => b.hint.startsWith("Das schützt"))?.hint).toBe(
      "Das schützt dich bis zum 2. Treffer.",
    );
    expect(extracted.text).toContain("Treffer.");
  });

  it("wraps long card fields, labels and the source line inside their box", async () => {
    const model = buildPrintModel(pkg, doc, { language: "de", createdAt });
    const card = model.cards[0]!;
    expect(card.fields.length).toBeGreaterThanOrEqual(2);
    const long = "V, M (eine Laternenscherbe und ein Faden aus gesponnenem Nebelgarn)";
    const fields = card.fields.map((f, i) => ({
      ...f,
      value: i % 2 === 0 ? "Gebündelte Aufmerksamkeit, bis zu 1 Minute" : long,
    }));
    const attribution = Array.from(
      { length: 6 },
      (_, i) => `Satz ${i + 1} der Quellenangabe, frei erfunden.`,
    ).join(" ");
    const pdf = await renderPdf({
      ...model,
      attribution,
      cards: [{ ...card, fields, rules: ["Ein Nebel\u2011 oder Laternenwurf."] }, ...model.cards.slice(1)],
    });
    const pages = await positions(pdf);
    const cards = pages.slice(pdf.sheetPages);
    const text = cards
      .flat()
      .map((p) => p.str)
      .join(" ");
    for (const word of ["Laternenscherbe", "gesponnenem", "Nebelgarn)", "Minute"])
      expect(text).toContain(word);
    // A non-breaking hyphen prints as a hyphen, not as a missing glyph.
    expect(text).toContain("Nebel- oder");
    expect(text).not.toContain("\u2011");
    // The whole source line is printed, on the page.
    expect(text).toContain("Satz 6 der Quellenangabe");
    for (const item of cards.flat()) expect(item.x + item.w).toBeLessThanOrEqual(210 - 10.5 + 0.2);

    // Card texts stay in their half of the card: grid starts 10.5 mm from the left, cards are 63 mm wide.
    const grid = { x: 10.5, y: (297 - 3 * 88) / 2, w: 63, pad: 4 };
    for (const item of cards[0]!.filter((p) => p.y > grid.y && p.y < grid.y + 3 * 88)) {
      const col = Math.floor((item.x - grid.x) / grid.w);
      const left = grid.x + col * grid.w + grid.pad;
      const half = (grid.w - 2 * grid.pad) / 2;
      const inSecondHalf = item.x >= left + half - 0.2;
      expect(item.x + item.w, item.str).toBeLessThanOrEqual(left + 2 * half + 0.2);
      // A value in the first column never runs into the second one.
      const isValue = fields.some((f) => f.value.includes(item.str));
      if (!inSecondHalf && isValue) expect(item.x + item.w, item.str).toBeLessThanOrEqual(left + half);
    }
  });

  it("wraps labels too long for their box instead of running out of it", async () => {
    const model = buildPrintModel(pkg, doc, { language: "de", createdAt });
    const sections = model.sections.map((s): SheetSection => {
      if (s.kind === "statBoxes")
        return { ...s, boxes: s.boxes.map((b) => ({ ...b, label: "Nebelwiderstandsschwellenwert-Stufe" })) };
      if (s.kind === "scoreColumn")
        return {
          ...s,
          scores: s.scores.map((sc) => ({
            ...sc,
            label: "Laternenfertigkeit",
            derivedLabel: "Laternenfertigkeitszuschlagswert",
          })),
        };
      return s;
    });
    const pdf = await renderPdf({ ...model, sections });
    const page = (await positions(pdf))[0]!;
    const primary = pdf.sheetLayout[0]!.find((p) => p.section.id === "primary")!;
    const scores = pdf.sheetLayout[0]!.find((p) => p.section.id === "scores")!;
    const boxes = primary.section.kind === "statBoxes" ? primary.section.boxes.length : 0;
    const boxW = (primary.w - 4 * (boxes - 1)) / boxes;
    // Only the boxes of the first row: other box sections lie below the scores.
    const inPrimary = (p: { y: number }) => p.y < scores.y;
    for (const item of page.filter((p) => /^NEBEL|STUFE$/u.test(p.str) && inPrimary(p))) {
      const box = Math.floor((item.x - primary.x) / (boxW + 4));
      const left = primary.x + box * (boxW + 4);
      expect(item.x).toBeGreaterThanOrEqual(left);
      expect(item.x + item.w).toBeLessThanOrEqual(left + boxW);
    }
    // The label and the derived label do not overlap.
    const labels = page.filter((p) => p.str === "Laternenfertigkeit" && p.x < scores.x + scores.w);
    const derived = page.filter((p) => p.str.startsWith("Laternenfertigkeitszuschlag"));
    expect(labels.length).toBe(4);
    expect(derived.length).toBe(4);
    for (const [i, l] of labels.entries()) {
      const d = derived[i]!;
      const apart = d.x >= l.x + l.w || Math.abs(d.y - l.y) >= 2.4;
      expect(apart).toBe(true);
      expect(d.x + d.w).toBeLessThanOrEqual(scores.x + scores.w);
    }
  });

  it("prints a box's own label instead of a long value name, whole words at 7 pt or more", async () => {
    // Six boxes in a row whose value names are long compounds, as in a package
    // whose section title already says what the boxes have in common.
    const values = ["might", "grace", "wit", "heart", "mightBonus", "graceBonus"];
    // "Laternenfertigkeit" is too wide for a sixth of the row even at 7 pt in capitals.
    const short = ["Kraft", "Flinkfingrigkeit", "Klugheit", "Herz", "Laternenfertigkeit", "Nebelsicht"];
    const de: Record<string, TextValue> = { ...pkg.texts["de"]!, "sheet.trials.title": "Widerstandsproben" };
    values.forEach((v, i) => {
      de[`value.${v}.name`] = `${short[i]}widerstandsprobe`;
      de[`sheet.trials.${v}`] = short[i]!;
    });
    const trials: ContentPackage["sheet"]["sections"][number] = {
      id: "trials",
      kind: "statBoxes",
      span: 12,
      boxes: values.map((v) => ({ value: v, style: "number", label: `sheet.trials.${v}` })),
    };
    const sheet = {
      ...pkg.sheet,
      sections: [pkg.sheet.sections[0]!, trials, ...pkg.sheet.sections.slice(1)],
    };
    const model = buildPrintModel({ ...pkg, sheet, texts: { ...pkg.texts, de } }, doc, {
      language: "de",
      createdAt,
    });
    const row = model.sections.find((s) => s.id === "trials");
    if (row?.kind !== "statBoxes") throw new Error("section missing");
    expect(row.boxes.map((b) => b.label)).toEqual(short);

    const pdf = await renderPdf(model);
    const placed = pdf.sheetLayout[0]!.find((p) => p.section.id === "trials")!;
    const inRow = (await positions(pdf))[0]!.filter(
      (p) => p.y > placed.y + 5 && p.y < placed.y + 25 && p.x >= placed.x && p.x < placed.x + placed.w,
    );
    // Each label is one piece of text in its box: the whole word, never split between letters.
    const boxW = (placed.w - 5 * 4) / 6;
    const labels = inRow.filter((p) => /^\p{L}+$/u.test(p.str));
    expect(labels.map((p) => p.str)).toEqual([
      ...short.slice(0, 4).map((s) => s.toLocaleUpperCase("de")),
      "Laternenfertigkeit",
      "NEBELSICHT",
    ]);
    labels.forEach((p, i) => {
      expect(p.x).toBeGreaterThanOrEqual(placed.x + i * (boxW + 4));
      expect(p.x + p.w).toBeLessThanOrEqual(placed.x + i * (boxW + 4) + boxW);
    });
    expect(inRow.some((p) => p.str.endsWith("-") || /widerstandsprobe/iu.test(p.str))).toBe(false);
    expect((await extract(pdf)).minFontSize).toBeGreaterThanOrEqual(7 - 0.01);
  });

  it("refuses a language without texts instead of mixing in another one", () => {
    expect(() => buildPrintModel(pkg, doc, { language: "fr" })).toThrow(PrintError);
  });
});

function demoCardThing(): string {
  const ev = evaluateDraft(pkg, doc);
  return ev.things.find((h) => pkg.things.find((t) => t.id === h.id)?.card)!.id;
}
