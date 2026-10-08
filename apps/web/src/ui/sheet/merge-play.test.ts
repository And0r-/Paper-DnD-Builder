import { describe, expect, it } from "vitest";
import { mergePlay } from "./merge-play.ts";

describe("play state changed in two places", () => {
  const base = { hp: 18, ticks: { checks: 1 }, note: "x" };

  it("keeps what only this window changed on top of what is stored", () => {
    const mine = { ...base, ticks: { checks: 2 } };
    const theirs = { ...base, hp: 7 };
    expect(mergePlay(base, mine, theirs)).toEqual({ hp: 7, ticks: { checks: 2 }, note: "x" });
  });

  it("keeps the stored value where both changed the same field", () => {
    expect(mergePlay(base, { ...base, hp: 12 }, { ...base, hp: 7 })).toEqual({ ...base, hp: 7 });
  });

  it("rubs out what this window rubbed out, and keeps what the other rubbed out", () => {
    const { note: _n, ...mine } = base;
    const { hp: _h, ...theirs } = base;
    void _n;
    void _h;
    expect(mergePlay(base, mine, theirs)).toEqual({ ticks: { checks: 1 } });
  });

  it("is the stored state when this window changed nothing", () => {
    expect(mergePlay(base, base, { hp: 3 })).toEqual({ hp: 3 });
  });
});
