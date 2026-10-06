import type { ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildSheetModel,
  pencilValue,
  playFields,
  rowCount,
  sheetFields,
  shownState,
  textAt,
  tickAt,
  withRowAdded,
  withRowRemoved,
  withText,
  type SheetModel,
} from "./index.ts";
import { sheetModelSchema } from "./schema.ts";
import { demoCharacter, loadDemoPackage, raisedCharacter } from "./testing.ts";

let pkg: ContentPackage;
let level3: SheetModel;
let level20: SheetModel;

beforeAll(async () => {
  pkg = await loadDemoPackage();
  const doc = demoCharacter(pkg, 3);
  const createdAt = new Date("2026-10-04T12:00:00Z");
  level3 = buildSheetModel(pkg, doc, { language: "de", createdAt });
  level20 = buildSheetModel(pkg, raisedCharacter(pkg, doc, 20), { language: "de", createdAt });
});

const valid = (m: SheetModel) => expect(sheetModelSchema.safeParse(m).error?.issues ?? []).toEqual([]);
const indexOf = (m: SheetModel, kind: string) => m.sections.findIndex((s) => s.kind === kind);

describe("changing a sheet like paper", () => {
  it("replaces any text and nothing else", () => {
    const path = ["sections", 0, "name"];
    expect(textAt(level3, path)).toBe("Mira Fennwick");
    const changed = withText(level3, path, "Mira vom Moor");
    expect(textAt(changed, path)).toBe("Mira vom Moor");
    expect(changed.sections.slice(1)).toEqual(level3.sections.slice(1));
    expect(textAt(level3, path)).toBe("Mira Fennwick");
    valid(changed);
  });

  it("leaves the model as it is for a path that is not a text", () => {
    for (const path of [["sections"], ["level"], ["sections", 99, "name"], ["nothing"], []]) {
      expect(withText(level3, path, "x")).toBe(level3);
    }
  });

  it("adds an empty row to a list and to tables, and crosses rows out", () => {
    for (const kind of ["list", "statTable", "featureTable"]) {
      const i = indexOf(level20, kind);
      expect(i, kind).toBeGreaterThanOrEqual(0);
      const before = rowCount(level20.sections[i]!);
      const added = withRowAdded(level20, i);
      expect(rowCount(added.sections[i]!)).toBe(before + 1);
      valid(added);
      const removed = withRowRemoved(added, i, 0);
      expect(rowCount(removed.sections[i]!)).toBe(before);
      valid(removed);
    }
    // A section without rows stays as it is.
    expect(withRowAdded(level3, indexOf(level3, "header"))).toBe(level3);
  });

  it("gives a feature row written in by hand an id of its own", () => {
    const i = indexOf(level20, "featureTable");
    const twice = withRowAdded(withRowAdded(level20, i), i);
    const s = twice.sections[i]!;
    if (s.kind !== "featureTable") throw new Error("not a feature table");
    const ids = s.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.rows.at(-1)).toMatchObject({ name: "", text: "", uses: null });
  });
});

describe("the play state on the shown sheet", () => {
  it("knows every place to write or tick that the sheet has, in its order", () => {
    for (const m of [level3, level20]) {
      const ids = playFields(m).map((f) => f.id);
      // The same places as the model's field list, without the cards and without uses written as words.
      const onSheet = sheetFields({ sections: m.sections, cards: [] });
      expect(ids).toEqual(onSheet.filter((id) => ids.includes(id)));
      expect(ids.length).toBeGreaterThan(3);
    }
  });

  it("skips fields the sheet does not have and cuts ticks to what a field holds", () => {
    const ticks = playFields(level3).find((f) => f.kind === "ticks")!;
    if (ticks.kind !== "ticks") throw new Error("no ticks");
    const pencil = playFields(level3).find((f) => f.kind === "pencil")!;
    const shown = shownState(level3, {
      [ticks.id]: { checks: ticks.max + 5 },
      [pencil.id]: 18,
      "sheet/elsewhere/value": 4,
    });
    expect(shown).toEqual({ [ticks.id]: { checks: ticks.max }, [pencil.id]: 18 });
    // A value of the wrong sort is not shown.
    expect(shownState(level3, { [ticks.id]: "x", [pencil.id]: { checks: 2 } })).toEqual({});
  });

  it("stores whole numbers written in pencil as numbers", () => {
    expect(pencilValue(" 18 ")).toBe(18);
    expect(pencilValue("-2")).toBe(-2);
    expect(pencilValue("18 und 3")).toBe("18 und 3");
    expect(pencilValue("  ")).toBeUndefined();
  });

  it("ticks up to the box tapped, and untaps the last one", () => {
    expect(tickAt(0, 2)).toBe(3);
    expect(tickAt(3, 2)).toBe(2);
    expect(tickAt(3, 0)).toBe(1);
    expect(tickAt(1, 0)).toBe(0);
  });
});
