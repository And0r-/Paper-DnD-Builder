import { describe, expect, it } from "vitest";
import {
  allFirst,
  headLine,
  isSingle,
  levelOwners,
  nextTrackLevel,
  trackLevels,
  unfitLevels,
  withFirst,
  withLevel,
  type TrackPlan,
} from "./model.ts";

const A = "calling.a";
const B = "calling.b";
const C = "calling.c";
const name = (t: string) => t.slice(-1).toUpperCase();

describe("tracks on screen", () => {
  it("a draft without tracks has every level in the first track", () => {
    const plan: TrackPlan = { level: 3, first: A, tracks: [] };
    expect(levelOwners(plan)).toEqual([A, A, A]);
    expect(trackLevels(plan)).toEqual([{ thing: A, levels: 3, from: 1 }]);
    expect(headLine(plan, name)).toBe("A");
    expect(isSingle(plan)).toBe(true);
  });

  it("counts levels per track in the order taken", () => {
    const plan: TrackPlan = { level: 5, first: A, tracks: [A, A, B, B] };
    expect(trackLevels(plan)).toEqual([
      { thing: A, levels: 3, from: 1 },
      { thing: B, levels: 2, from: 4 },
    ]);
    expect(nextTrackLevel(plan, B)).toBe(3);
    expect(nextTrackLevel(plan, C)).toBe(1);
  });

  it("puts most levels first in the head, the first track on a tie", () => {
    expect(headLine({ level: 5, first: A, tracks: [B, B, B, B] }, name)).toBe("B 4 / A 1");
    expect(headLine({ level: 4, first: A, tracks: [B, A, B] }, name)).toBe("A 2 / B 2");
    expect(headLine({ level: 8, first: A, tracks: [A, A, A, A, A, B, B] }, name)).toBe("A 6 / B 2");
  });

  it("gives a level to another track and back without growing the draft", () => {
    const plan: TrackPlan = { level: 5, first: A, tracks: [] };
    const split = withLevel(withLevel(plan, 4, B), 5, B);
    expect(split.tracks).toEqual([A, A, B, B]);
    const back = withLevel(split, 5, A);
    expect(back.tracks).toEqual([A, A, B]);
    expect(allFirst(split).tracks).toEqual([]);
    expect(isSingle(allFirst(split))).toBe(true);
  });

  it("a new first track takes over the levels of the old one", () => {
    const plan: TrackPlan = { level: 5, first: A, tracks: [A, A, B, B] };
    const changed = withFirst(plan, C);
    expect(levelOwners(changed)).toEqual([C, C, C, B, B]);
  });

  it("names the levels of a track that no longer fits", () => {
    const plan: TrackPlan = { level: 5, first: A, tracks: [A, A, B, B] };
    expect(unfitLevels(plan, new Set([B]))).toEqual([4, 5]);
    expect(unfitLevels(plan, new Set([A]))).toEqual([2, 3]);
  });
});
