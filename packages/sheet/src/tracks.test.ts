import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateDraft, type DraftDocument } from "@builder/core";
import { DEMO_EXAMPLES_DIR } from "@builder/demo-package";
import type { ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, type SheetModel } from "./index.ts";
import { MESSAGES } from "./messages.ts";
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

    it(`says in the head which calling came first, right after the callings (${name})`, () => {
      const first = docs[name]!.answers["calling"] as { pick: string };
      for (const language of Object.keys(expected[name]!.tracksLine)) {
        const fields = header(sheet(name, language)).fields;
        expect(fields[1]).toEqual({
          label: MESSAGES[language]!.startedAs,
          text: pkg.texts[language]![`${first.pick}.name`],
        });
      }
    });

    it(`lists the knacks in a block per calling, most levels first, ranks inside (${name})`, () => {
      const m = sheet(name, "en");
      const knacks = m.sections.find((s) => s.id === "knacks");
      if (knacks?.kind !== "featureTable") throw new Error("no knacks");
      const callings = expected[name]!.tracksLine["en"]!.split(" / ").map((c) => c.replace(/ \d+$/, ""));
      const titles = [...new Set(knacks.rows.map((r) => r.group?.title ?? ""))];
      // Each calling's groups follow each other, the one with more levels first.
      const blockOf = titles.map((t) => callings.findIndex((c) => t.startsWith(`${c} · `)));
      expect(blockOf).not.toContain(-1);
      expect(blockOf).toEqual([...blockOf].sort());
      expect(new Set(blockOf).size).toBe(2);
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

describe("a sheet with two tracks, the head and shared things", () => {
  it("names the first calling first in the head when no field shows the callings", () => {
    const plain = structuredClone(pkg);
    const head = plain.sheet.sections.find((s) => s.kind === "header");
    if (head?.kind === "header") head.fields = (head.fields ?? []).filter((f) => !("tracks" in f));
    const h = header(buildSheetModel(plain, docs["herbalist-river-runner"]!, { language: "de", createdAt }));
    if (h.kind !== "header") throw new Error("no header");
    expect(h.fields[0]).toEqual({
      label: MESSAGES["de"]!.startedAs,
      text: pkg.texts["de"]!["calling.herbalist.name"],
    });
  });

  it("does not name a first calling for a character with one", () => {
    const one = structuredClone(docs["lantern-herbalist"]!);
    one.tracks = one.tracks!.map(() => "calling.lantern-bearer");
    const h = header(buildSheetModel(pkg, one, { language: "en", createdAt }));
    if (h.kind !== "header") throw new Error("no header");
    expect(h.fields.map((f) => f.label)).not.toContain(MESSAGES["en"]!.startedAs);
  });

  it("shows a thing that both callings grant once, under the calling that brought it first", () => {
    const shared = structuredClone(pkg);
    const herbalist = shared.things.find((t) => t.id === "calling.herbalist")!;
    herbalist.grants = [...(herbalist.grants ?? []), { thing: "trait.steady-flame", atLevel: 2 }];
    const m = buildSheetModel(shared, docs["lantern-herbalist"]!, { language: "en", createdAt });
    const traits = m.sections.find((s) => s.id === "traits");
    if (traits?.kind !== "featureTable") throw new Error("no traits");
    const rows = traits.rows.filter((r) => r.id === "trait.steady-flame");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.group?.title).toBe(pkg.texts["en"]!["calling.lantern-bearer.name"]);
  });
});
