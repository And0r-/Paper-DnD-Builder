/**
 * Writes sample PDFs of a demo character: German with meters, English with
 * feet, and German with an over-long (invented) rules text on the first
 * card, to show continuation cards. Usage:
 * node packages/print/scripts/sample.ts <outDir>
 */
import type { ContentPackage } from "@builder/format";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrintModel, renderPdf } from "../src/index.ts";
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
