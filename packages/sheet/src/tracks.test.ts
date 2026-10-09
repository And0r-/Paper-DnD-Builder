import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateDraft, type DraftDocument } from "@builder/core";
import { DEMO_EXAMPLES_DIR } from "@builder/demo-package";
import type { ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, type SheetModel } from "./index.ts";
import { sheetModelSchema } from "./schema.ts";
import { demoExample, demoWithTracksHead, loadDemoPackage } from "./testing.ts";

const createdAt = new Date("2026-10-04T12:00:00Z");

let pkg: ContentPackage;
/** The demo's example characters: lantern bearer 3 / herbalist 2, herbalist 1 / river runner 4. */
const docs: Record<string, DraftDocument> = {};
let expected: Record<
  string,
  { tracksLine: Record<string, string>; cards: Record<string, { target: number; hit: number }> }
>;
beforeAll(async () => {
  pkg = demoWithTracksHead(await loadDemoPackage());
  expected = JSON.parse(await readFile(join(DEMO_EXAMPLES_DIR, "expected.json"), "utf8"));
  for (const name of ["lantern-herbalist", "herbalist-river-runner"]) docs[name] = await demoExample(name);
});

const sheet = (name: string, language: string): SheetModel =>
  buildSheetModel(pkg, docs[name]!, { language, createdAt });
const header = (m: SheetModel) => m.sections.find((s) => s.kind === "header")!;

describe("a sheet with two tracks", () => {
  for (const name of ["lantern-herbalist", "herbalist-river-runner"]) {
    it(`names the callings with their levels in the head and the summary, most levels first (${name})`, () => {
      expect(evaluateDraft(pkg, docs[name]!).complete).toBe(true);
      for (const [language, line] of Object.entries(expected[name]!.tracksLine)) {
        const m = sheet(name, language);
        const h = header(m);
        if (h.kind !== "header") throw new Error("no header");
        expect(h.fields[0]!.text).toBe(line);
        expect(h.summary).toContain(line);
        expect(sheetModelSchema.safeParse(JSON.parse(JSON.stringify(m))).success).toBe(true);
      }
    });

    it(`shows on each knack card the numbers of the choice it was picked in (${name})`, () => {
      const m = sheet(name, "en");
      for (const [id, { target, hit }] of Object.entries(expected[name]!.cards)) {
        const card = m.cards.find((c) => c.id === id);
        expect(card?.origin?.value).toMatch(
          new RegExp(`\\b${target}\\b.*\\b${hit}\\b|\\b${hit}\\b.*\\b${target}\\b`),
        );
      }
    });
  }
});
