/**
 * Writes sample PDFs of a demo character: German with meters, English with
 * feet, German with an over-long (invented) rules text on the first card,
 * to show continuation cards, and German with an over-long section, label
 * and card field (all invented), to show that nothing is cut off; and the
 * sheet alone of the level 20 character in the verbose design, as a kept
 * copy with the play state filled in (German) and empty (English). Usage:
 * node packages/print/scripts/sample.ts <outDir>
 */
import type { ContentPackage } from "@builder/format";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSheetModel, type SheetModel } from "@builder/sheet";
import { demoCharacter, loadDemoPackage } from "@builder/sheet/testing";
import type { PlayState } from "@builder/sheet";
import { renderPdf } from "../src/index.ts";

const out = process.argv[2] ?? ".";
await mkdir(out, { recursive: true });
const pkg = await loadDemoPackage();
const doc = demoCharacter(pkg);
const createdAt = new Date("2026-10-04T12:00:00Z");

const firstCard = buildSheetModel(pkg, doc, { language: "de" }).cards[0]!.name;
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
  const pdf = await renderPdf(buildSheetModel(p, doc, { language, units, createdAt }));
  await writeFile(path.join(out, file), pdf.bytes);
  console.log(`${file}: ${pdf.pages} pages (${pdf.sheetPages} sheet, ${pdf.cardPages} cards)`);
}

const model = buildSheetModel(pkg, doc, { language: "de", units: { length: "m", weight: "kg" }, createdAt });
const overLong: SheetModel = {
  ...model,
  sections: model.sections.map((s) => {
    if (s.kind === "checkList") {
      const more = Array.from({ length: 70 }, (_, i) => ({
        name: `Erfundenes Talent ${i + 1}`,
        marked: i % 3 === 0,
        note: "",
        total: { text: "", parts: "" },
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

// The sheet alone, as a kept copy, filled with a play state and empty.
const level20 = demoCharacter(pkg, 20);
for (const [language, units, name, play, file] of [
  [
    "de",
    { length: "m", weight: "kg" },
    "Meine Fassung vom 6. Oktober 2026",
    {
      "sheet/header/playedBy": "Sam",
      "sheet/primary/stamina": 61,
      "sheet/primary/luck": { checks: 2 },
      "sheet/recovery/restDice": { checks: 25 },
      "sheet/knacks/knack.glow-thread/uses": { checks: 1 },
      "sheet/lantern-slots/lanternSlots1": { checks: 3 },
      "sheet/gear/lines": "Ersatzdocht\nKarte vom Moor",
      "sheet/notes/notes": "Dem Fährmann zwei Münzen schuldig. Den Glöckner nach dem Turm fragen.",
    },
    "demo-character-de-copy-filled.pdf",
  ],
  [
    "en",
    { length: "ft", weight: "lb" },
    "My version of 6 October 2026",
    {},
    "demo-character-en-copy-empty.pdf",
  ],
] as const) {
  const original = buildSheetModel(pkg, level20, { language, units, createdAt });
  if (original.origin.kind !== "original") throw new Error("not an original");
  const copy: SheetModel = {
    ...original,
    origin: {
      kind: "copy",
      name,
      createdAt: "2026-10-06T14:20:00.000Z",
      fromLevel: original.origin.level,
      fromPackageVersion: original.origin.packageVersion,
    },
  };
  const pdf = await renderPdf(copy, { parts: ["sheet"], design: "verbose", play: play as PlayState });
  await writeFile(path.join(out, file), pdf.bytes);
  console.log(`${file}: ${pdf.pages} pages`);
}
