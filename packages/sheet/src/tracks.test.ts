import { evaluateDraft, type DraftDocument } from "@builder/core";
import type { ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSheetModel, type SheetModel } from "./index.ts";
import { sheetModelSchema } from "./schema.ts";
import { demoCharacter, demoWithTracks, loadDemoPackage } from "./testing.ts";

const L = "calling.lantern-bearer";
const H = "calling.herbalist";
const createdAt = new Date("2026-10-04T12:00:00Z");

let pkg: ContentPackage;
/** Lantern bearer 2 / herbalist 3: the herbalist has the most levels, so it comes first in the head. */
let doc: DraftDocument;
beforeAll(async () => {
  pkg = demoWithTracks(await loadDemoPackage());
  doc = demoCharacter(pkg, 5, "Mira Fennwick", L, [L, H, H, H]);
});

const sheet = (language: string): SheetModel => buildSheetModel(pkg, doc, { language, createdAt });
const header = (m: SheetModel) => m.sections.find((s) => s.kind === "header")!;

describe("a sheet with two tracks", () => {
  it("names the callings with their levels in the head and the summary, most levels first", () => {
    expect(evaluateDraft(pkg, doc).complete).toBe(true);
    for (const [language, names] of [
      ["en", "Herbalist 3 / Lantern Bearer 2"],
      ["de", "Kräuterkundige 3 / Laternenträgerin 2"],
    ] as const) {
      const h = header(sheet(language));
      if (h.kind !== "header") throw new Error("no header");
      expect(h.fields[0]!.text).toBe(names);
      expect(h.summary).toContain(names);
      expect(sheetModelSchema.safeParse(JSON.parse(JSON.stringify(sheet(language)))).success).toBe(true);
    }
  });

  it("shows on each knack card the numbers of the calling it was picked for", () => {
    const ev = evaluateDraft(pkg, doc);
    const m = sheet("en");
    const pickedIn = (id: string) => ev.things.find((t) => t.id === id)?.pickedIn;
    const lantern = m.cards.find((c) => pickedIn(c.id) === "knacks-lantern")!;
    const root = m.cards.find((c) => pickedIn(c.id) === "knacks-root@calling.herbalist")!;
    const numbers = (bonus: string) => {
      const practice = ev.values["practice"]!;
      const b = ev.values[bonus]!;
      return [8 + practice + b, practice + b];
    };
    const [lt, lh] = numbers("heartBonus");
    const [rt, rh] = numbers("mightBonus");
    // The demo's scores make the two callings' numbers differ.
    expect([lt, lh]).not.toEqual([rt, rh]);
    expect(lantern.origin!.value).toContain(String(lt));
    expect(lantern.origin!.value).toContain(String(lh));
    expect(root.origin!.value).toContain(String(rt));
    expect(root.origin!.value).toContain(String(rh));
  });
});
