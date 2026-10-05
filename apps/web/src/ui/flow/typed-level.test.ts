import { describe, expect, it } from "vitest";
import { typedLevel } from "./typed-level.ts";

describe("typedLevel", () => {
  it("takes a whole number in range at once", () => {
    expect(typedLevel("5", 1, 20)).toEqual({ level: 5, complete: true, invalid: false });
    expect(typedLevel("20", 1, 20)).toEqual({ level: 20, complete: true, invalid: false });
    expect(typedLevel(" 12 ", 1, 20)).toEqual({ level: 12, complete: true, invalid: false });
  });

  it("knows a level that may still grow by a digit", () => {
    expect(typedLevel("1", 1, 20)).toEqual({ level: 1, complete: false, invalid: false });
    expect(typedLevel("2", 1, 20)).toEqual({ level: 2, complete: false, invalid: false });
  });

  it("does not call the start of a valid level wrong", () => {
    // Above level 3 only 4 to 20: "1" is on the way to "12".
    expect(typedLevel("1", 4, 20)).toEqual({ complete: false, invalid: false });
    expect(typedLevel("", 1, 20)).toEqual({ complete: false, invalid: false });
  });

  it("calls empty-handed numbers wrong: 0, over the top, below and not able to grow, not whole", () => {
    expect(typedLevel("0", 1, 20).invalid).toBe(true);
    expect(typedLevel("25", 1, 20).invalid).toBe(true);
    expect(typedLevel("3", 4, 20).invalid).toBe(true);
    expect(typedLevel("2.5", 1, 20).invalid).toBe(true);
    expect(typedLevel("-1", 1, 20).invalid).toBe(true);
    expect(typedLevel("25", 1, 20).level).toBeUndefined();
  });
});
