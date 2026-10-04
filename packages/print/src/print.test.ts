import type { DraftDocument } from "@builder/core";
import { evaluateDraft } from "@builder/core";
import type { ContentPackage, TextValue } from "@builder/format";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { MESSAGES } from "./messages.ts";
import { buildPrintModel, PrintError } from "./model.ts";
import { renderPdf, type RenderedPdf } from "./render.ts";
import { demoCharacter, loadDemoPackage } from "./testing.ts";

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
    // Level 1: the level-3 "path" section is left out (`when`), so notes end up alone.
    const level1 = demoCharacter(pkg, 1);
    const { pdf } = await print("de", {}, pkg, level1);
    const last = pdf.sheetLayout.at(-1)!;
    expect(last.map((p) => p.section.id)).toEqual(["notes"]);
    const notes = last[0]!;
    expect(notes.w).toBeCloseTo(186);
    // Lines 6 mm apart down to the footer (A4: 297 mm, footer line about 15 mm above the edge).
    expect(notes.section.kind === "notes" && notes.section.lines).toBeGreaterThan(35);

    // With room on the first page, notes keep their width and shrink to the space left.
    const short = {
      ...pkg,
      sheet: { ...pkg.sheet, sections: pkg.sheet.sections.filter((s) => s.id !== "gear") },
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

  it("leaves out sections and boxes whose `when` is false; the rest moves up", async () => {
    const title = pkg.texts["de"]!["sheet.path.title"] as string;
    const pathShort = pkg.texts["de"]!["path.lightwarden.short"] as string;

    // Level 3: "level >= 3" holds, the section is on the sheet.
    const { model, pdf, extracted } = await print("de", {});
    expect(model.sections.map((s) => s.id)).toContain("path");
    expect(pdf.sheetLayout.flat().map((p) => p.section.id)).toContain("path");
    expect(extracted.text).toContain(pathShort);

    // Level 2: no section, no title, no empty frame; every other section still placed.
    const level2 = demoCharacter(pkg, 2);
    const low = await print("de", {}, pkg, level2);
    const ids = pkg.sheet.sections.map((s) => s.id).filter((id) => id !== "path");
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
    expect(primary.boxes).toHaveLength(4);
    const none = buildPrintModel(
      withBoxWhen(() => "level > 99"),
      doc,
      { language: "de", createdAt },
    );
    expect(none.sections.map((s) => s.id)).not.toContain("primary");
  });

  it("refuses a language without texts instead of mixing in another one", () => {
    expect(() => buildPrintModel(pkg, doc, { language: "fr" })).toThrow(PrintError);
  });
});

function demoCardThing(): string {
  const ev = evaluateDraft(pkg, doc);
  return ev.things.find((h) => pkg.things.find((t) => t.id === h.id)?.card)!.id;
}
