import { describe, expect, it } from "vitest";
import { assignPicks, fillPicks, type PoolSlot } from "./pool.ts";

const slot = (count: number, ...offers: string[]): PoolSlot => ({ count, offers: new Set(offers) });

describe("assignPicks", () => {
  it("moves earlier picks along a chain to make room", () => {
    const slots = [slot(1, "a", "b"), slot(1, "b", "c"), slot(1, "c", "d")];
    // a needs slot 0: b moves to 1, which pushes c on to 2.
    const at = assignPicks(
      slots,
      ["a", "b", "c"],
      new Map([
        ["b", 0],
        ["c", 1],
      ]),
    );
    expect(Object.fromEntries(at!)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("keeps picks where they are when there is room elsewhere", () => {
    const slots = [slot(1, "a", "b"), slot(1, "a", "b")];
    const at = assignPicks(slots, ["a", "b"], new Map([["a", 1]]));
    expect(Object.fromEntries(at!)).toEqual({ a: 1, b: 0 });
  });

  it("gives up when no assignment exists", () => {
    expect(assignPicks([slot(1, "a"), slot(1, "a", "b")], ["a", "c"])).toBeUndefined();
  });
});

describe("fillPicks", () => {
  it("skips candidates that would leave no assignment and fills every place", () => {
    const slots = [slot(1, "a"), slot(2, "a", "b", "c")];
    expect(fillPicks(slots, ["b", "c", "x", "a", "b"])).toEqual(["b", "c", "a"]);
  });
});
