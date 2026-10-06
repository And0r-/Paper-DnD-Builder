import { describe, expect, it } from "vitest";
import type { FlowEntry } from "./model.ts";
import { stepChange, stepsSignature } from "./step-changes.ts";

/** Entries from [key, section, choices] triples; parts of a section follow its first entry. */
function flow(...specs: [key: string, section: number, choices?: number, title?: string][]): FlowEntry[] {
  return specs.map(([key, section, choices = 1, title = `Title ${key}`]) => {
    const same = specs.filter((s) => s[1] === section);
    const part = same.findIndex((s) => s[0] === key) + 1;
    return {
      key,
      kind: "step",
      href: `/c/x/step/${key}`,
      title,
      status: "open",
      choices: Array.from({ length: choices }, (_, i) => `${key}.${i}`),
      section,
      part,
      parts: same.length,
      sectionKey: same[0]![0],
      atLevel: 1,
    };
  });
}

describe("stepChange", () => {
  it("is null when the same steps stand", () => {
    const a = flow(["a", 0], ["b", 1]);
    expect(stepChange(a, flow(["a", 0], ["b", 1]))).toBeNull();
    expect(stepsSignature(a)).toBe(stepsSignature(flow(["a", 0], ["b", 1])));
  });

  it("names a step that came, and one that asks more than before", () => {
    const c = stepChange(flow(["a", 0], ["b", 1]), flow(["a", 0], ["b", 1, 2], ["c", 2]))!;
    expect([...c.added]).toEqual(["b", "c"]);
    expect(c.gone).toEqual([]);
  });

  it("keeps a whole step that went after the step it followed", () => {
    const c = stepChange(flow(["a", 0], ["b", 1], ["b2", 1], ["c", 2]), flow(["a", 0], ["c", 1]))!;
    expect(c.gone).toEqual([{ key: "b", title: "Title b", whole: true, section: "a", after: "a" }]);
  });

  it("puts a whole step that went first at the top", () => {
    const c = stepChange(flow(["a", 0], ["b", 1]), flow(["b", 0]))!;
    expect(c.gone).toEqual([
      { key: "a", title: "Title a", whole: true, section: undefined, after: undefined },
    ]);
  });

  it("keeps a part that went inside the step that stays", () => {
    const c = stepChange(
      flow(["a", 0], ["a2", 0], ["a3", 0], ["b", 1]),
      flow(["a", 0], ["a3", 0], ["b", 1]),
    )!;
    expect(c.gone).toEqual([{ key: "a2", title: "Title a2", whole: false, section: "a", after: "a" }]);
  });

  it("does not show a step as gone and new when it keeps its name under another key (AND-100)", () => {
    const c = stepChange(
      flow(["a", 0], ["way-1", 1, 1, "Way"], ["x", 2]),
      flow(["a", 0], ["way-2", 1, 1, "Way"], ["y", 2]),
    )!;
    expect([...c.added]).toEqual(["y"]);
    expect(c.gone.map((g) => g.key)).toEqual(["x"]);
    expect(
      stepChange(flow(["a", 0], ["way-1", 1, 1, "Way"]), flow(["a", 0], ["way-2", 1, 1, "Way"])),
    ).toBeNull();
  });

  it("pairs a part with a part of the same name in the same step", () => {
    const c = stepChange(
      flow(["a", 0], ["p-1", 0, 1, "Part"], ["b", 1], ["q", 1, 1, "Part"]),
      flow(["a", 0], ["p-2", 0, 1, "Part"], ["b", 1]),
    )!;
    // The part of step a kept its name; the part of step b went.
    expect([...c.added]).toEqual([]);
    expect(c.gone.map((g) => g.key)).toEqual(["q"]);
  });
});
