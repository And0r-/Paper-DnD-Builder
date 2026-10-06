import { describe, expect, it } from "vitest";
import { levelHeading, levelSpan } from "./level-runs.ts";

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
