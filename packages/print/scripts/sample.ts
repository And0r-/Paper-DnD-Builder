/**
 * Writes sample PDFs of a demo character: German with meters and English
 * with feet. Usage: node packages/print/scripts/sample.ts <outDir>
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrintModel, renderPdf } from "../src/index.ts";
import { demoCharacter, loadDemoPackage } from "../src/testing.ts";

const out = process.argv[2] ?? ".";
await mkdir(out, { recursive: true });
const pkg = await loadDemoPackage();
const doc = demoCharacter(pkg);
const createdAt = new Date("2026-10-04T12:00:00Z");
for (const [language, units, file] of [
  ["de", { length: "m", weight: "kg" }, "demo-character-de-meters.pdf"],
  ["en", { length: "ft", weight: "lb" }, "demo-character-en-feet.pdf"],
] as const) {
  const pdf = await renderPdf(buildPrintModel(pkg, doc, { language, units, createdAt }));
  await writeFile(path.join(out, file), pdf.bytes);
  console.log(`${file}: ${pdf.pages} pages (${pdf.sheetPages} sheet, ${pdf.cardPages} cards)`);
}
