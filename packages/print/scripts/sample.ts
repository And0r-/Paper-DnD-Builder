/**
 * Writes sample PDFs of a demo character: German with meters, English with
 * feet, German with an over-long (invented) rules text on the first card,
 * to show continuation cards, and German with an over-long section, label
 * and card field (all invented), to show that nothing is cut off. Usage:
 * node packages/print/scripts/sample.ts <outDir>
 */
import type { ContentPackage } from "@builder/format";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrintModel, renderPdf, type PrintModel } from "../src/index.ts";
import { demoCharacter, loadDemoPackage } from "../src/testing.ts";

const out = process.argv[2] ?? ".";
await mkdir(out, { recursive: true });
const pkg = await loadDemoPackage();
const doc = demoCharacter(pkg);
const createdAt = new Date("2026-10-04T12:00:00Z");

const firstCard = buildPrintModel(pkg, doc, { language: "de" }).cards[0]!.name;
const cardThing = pkg.things.find((t) => t.card && pkg.texts["de"]![`${t.id}.name`] === firstCard)!;
const longRules: ContentPackage = {
  ...pkg,
  texts: {
    ...pkg.texts,
    de: {
      ...pkg.texts["de"]!,
      [`${cardThing.id}.rules`]: Array.from(
        { length: 30 },
        (_, i) => `Satz ${i + 1}: Die Laterne flackert, und der Nebel weicht zurück.`,
      ).join(" "),
    },
  },
};

for (const [p, language, units, file] of [
  [pkg, "de", { length: "m", weight: "kg" }, "demo-character-de-meters.pdf"],
  [pkg, "en", { length: "ft", weight: "lb" }, "demo-character-en-feet.pdf"],
  [longRules, "de", { length: "m", weight: "kg" }, "demo-character-de-long-rules-text.pdf"],
] as const) {
  const pdf = await renderPdf(buildPrintModel(p, doc, { language, units, createdAt }));
  await writeFile(path.join(out, file), pdf.bytes);
  console.log(`${file}: ${pdf.pages} pages (${pdf.sheetPages} sheet, ${pdf.cardPages} cards)`);
}

const model = buildPrintModel(pkg, doc, { language: "de", units: { length: "m", weight: "kg" }, createdAt });
const overLong: PrintModel = {
  ...model,
  sections: model.sections.map((s) => {
    if (s.kind === "checkList") {
      const more = Array.from({ length: 70 }, (_, i) => ({
        name: `Erfundenes Talent ${i + 1}`,
        marked: i % 3 === 0,
        note: "",
      }));
      return { ...s, items: [...s.items, ...more] };
    }
    if (s.kind === "statBoxes")
      return {
        ...s,
        boxes: s.boxes.map((b, i) => (i === 1 ? { ...b, label: "Laternenschutzwert-Stufe" } : b)),
      };
    return s;
  }),
  cards: model.cards.map((c, i) =>
    i === 0
      ? {
          ...c,
          fields: c.fields.map((f, j) =>
            j === c.fields.length - 1
              ? { ...f, value: "V, M (eine Laternenscherbe und ein Faden aus gesponnenem Nebelgarn)" }
              : f,
          ),
        }
      : c,
  ),
};
const file = "demo-character-de-over-long.pdf";
const pdf = await renderPdf(overLong);
await writeFile(path.join(out, file), pdf.bytes);
console.log(`${file}: ${pdf.pages} pages (${pdf.sheetPages} sheet, ${pdf.cardPages} cards)`);
