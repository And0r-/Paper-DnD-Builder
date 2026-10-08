import { describe, expect, it } from "vitest";
import { flashCss, spotsOf } from "./spot.ts";

describe("where a change landed", () => {
  it("points at the rows or cards that changed, then the question as a whole", () => {
    expect(spotsOf({ change: { kind: "answer", choice: "scores" }, parts: ["mightBase"] })).toEqual([
      '[id="block-scores"] [data-option="mightBase"]',
      '[id="block-scores"] [data-target="mightBase"]',
      '[id="block-scores"]',
    ]);
    expect(spotsOf({ change: { kind: "answer", choice: "name" } })).toEqual(['[id="block-name"]']);
    expect(spotsOf({ change: { kind: "pool", step: "spells" } })).toEqual(['[id="block-pool"]']);
    expect(spotsOf({ change: { kind: "level", level: 4 } })).toEqual([".topbar__level"]);
    expect(spotsOf({ change: { kind: "state", stateVersion: 2 } })).toEqual([]);
    expect(spotsOf({})).toEqual([]);
  });

  it("keeps quotes in ids inside the selector", () => {
    expect(spotsOf({ change: { kind: "answer", choice: 'a"b' } })).toEqual(['[id="block-a\\"b"]']);
  });

  it("lights up with one animation, and with the other on a second look", () => {
    expect(flashCss(".x")).toContain("animation: live-flash 3000ms");
    expect(flashCss(".x", true)).toContain("animation: live-flash-again 3000ms");
  });
});
