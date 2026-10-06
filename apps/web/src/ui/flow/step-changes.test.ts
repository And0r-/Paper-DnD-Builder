import { describe, expect, it } from "vitest";
import type { FlowEntry } from "./model.ts";
import { stepChange, stepsSignature } from "./step-changes.ts";

/** Entries from [key, section, choices] triples; parts of a section follow its first entry. */
function flow(...specs: [key: string, section: number, choices?: number][]): FlowEntry[] {
  return specs.map(([key, section, choices = 1]) => {
    const same = specs.filter((s) => s[1] === section);
    const part = same.findIndex((s) => s[0] === key) + 1;
    return {
      key,
      kind: "step",
      href: `/c/x/step/${key}`,
      title: `Title ${key}`,
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
});
