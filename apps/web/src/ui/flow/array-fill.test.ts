import { describe, expect, it } from "vitest";
import { fillArray, forcedArray, freeMarks } from "./array-fill.ts";

const ABC = ["a", "b", "c"];

describe("fillArray", () => {
  it("leaves the row open while a higher number is still free", () => {
    expect(fillArray(ABC, [2, 1, 0], { a: 2 })).toEqual({ assign: { a: 2 }, free: [1, 0], implicit: [] });
  });

  it("gives the lowest number to the last open row by itself", () => {
    expect(fillArray(ABC, [2, 1, 0], { a: 2, c: 1 })).toEqual({
      assign: { a: 2, c: 1, b: 0 },
      free: [],
      implicit: ["b"],
    });
  });

  it("needs no tap when every number is the same", () => {
    expect(fillArray(ABC, [1, 1, 1], {}).implicit).toEqual(ABC);
    expect(forcedArray(ABC, [1, 1, 1])).toEqual({ a: 1, b: 1, c: 1 });
    expect(forcedArray(ABC, [2, 1, 0])).toBeUndefined();
  });

  it("ignores a tap with a number that is not free", () => {
    expect(fillArray(ABC, [2, 1, 0], { a: 2, b: 2 }).assign).toEqual({ a: 2 });
  });

  it("frees a number taken back from the middle of a long row", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    const { free } = fillArray(six, [15, 14, 13, 12, 10, 8], { a: 15, c: 13 });
    expect(free).toEqual([14, 12, 10, 8]);
    expect(
      freeMarks([15, 14, 13, 12, 10, 8], free)
        .filter((m) => m.used)
        .map((m) => m.n),
    ).toEqual([15, 13]);
  });
});
