import { describe, expect, it } from "vitest";
import { sumModifiers } from "./index.ts";

describe("sumModifiers", () => {
  it("returns 0 for no modifiers", () => {
    expect(sumModifiers({})).toBe(0);
  });

  it("adds modifiers from opaque sources", () => {
    expect(sumModifiers({ "demo:moss-blessing": 2, "demo:heavy-boots": -1 })).toBe(1);
  });

  it("rejects non-finite values", () => {
    expect(() => sumModifiers({ broken: Number.NaN })).toThrow(RangeError);
  });
});
