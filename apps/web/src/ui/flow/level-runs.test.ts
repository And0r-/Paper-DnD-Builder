import { describe, expect, it } from "vitest";
import { levelHeading, levelSpan } from "./level-runs.ts";
import { byLevel, type FlowEntry } from "./model.ts";

describe("level headings in the step list", () => {
  it("heads a step of the first level that follows one of a higher level", () => {
    // A group starting at level 1: a level-3 step, then a level-1 step.
    expect(levelHeading(1, 3, 1)).toBe("from");
    expect(levelHeading(3, 1, 1)).toBe("at");
  });

  it("adds no heading while the level stays, nor for the first level at the start", () => {
    expect(levelHeading(1, 1, 1)).toBeUndefined();
    expect(levelHeading(3, 3, 1)).toBeUndefined();
  });

  it("heads every change between higher levels", () => {
    expect(levelHeading(3, 11, 1)).toBe("from");
    expect(levelHeading(11, 3, 1)).toBe("from");
  });
});

describe("level span of a group", () => {
  it("names the lower level first, whatever the order of the steps", () => {
    expect(levelSpan([3, 1])).toEqual({ from: 1, to: 3 });
    expect(levelSpan([3, 11, 1, 4])).toEqual({ from: 1, to: 11 });
  });

  it("has no span when all steps share one level", () => {
    expect(levelSpan([3, 3])).toBeUndefined();
    expect(levelSpan([])).toBeUndefined();
  });
});

describe("steps of a section by level", () => {
  const entry = (key: string, section: number, atLevel: number, sectionTitle?: string): FlowEntry => ({
    key,
    kind: "step",
    href: "",
    title: key,
    status: "open",
    choices: [],
    section,
    part: 1,
    parts: 1,
    sectionKey: key,
    atLevel,
    ...(sectionTitle !== undefined && { sectionTitle }),
  });

  it("puts a gathered group's steps from the lowest level up; the first one leads with the group's name", () => {
    const out = byLevel([
      entry("a", 0, 1),
      entry("path", 1, 3, "Way"),
      entry("craft", 1, 1),
      entry("b", 2, 1),
    ]);
    expect(out.map((e) => e.key)).toEqual(["a", "craft", "path", "b"]);
    expect(out[1]).toMatchObject({ sectionKey: "craft", sectionTitle: "Way" });
    expect(out[2]!.sectionKey).toBe("craft");
    expect(out[2]!.sectionTitle).toBeUndefined();
  });

  it("keeps the package's order within one level", () => {
    const out = byLevel([entry("x", 1, 4, "G"), entry("y", 1, 2), entry("z", 1, 4), entry("w", 1, 2)]);
    expect(out.map((e) => e.key)).toEqual(["y", "w", "x", "z"]);
  });

  it("keeps the step that opens any other section first", () => {
    const out = byLevel([entry("class", 1, 3), entry("late", 1, 5), entry("early", 1, 1)]);
    expect(out.map((e) => e.key)).toEqual(["class", "early", "late"]);
    expect(out.every((e) => e.sectionKey === "class")).toBe(true);
  });
});
