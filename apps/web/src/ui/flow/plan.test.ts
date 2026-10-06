import { describe, expect, it } from "vitest";
import type { FlowEntry } from "./model.ts";
import { planDiff } from "./plan.ts";

/** Entries from [key, section, title] triples; parts of a section follow its first entry. */
function flow(...specs: [key: string, section: number, title: string][]): FlowEntry[] {
  return specs.map(([key, section, title]) => {
    const same = specs.filter((s) => s[1] === section);
    return {
      key,
      kind: "step",
      href: `/c/x/step/${key}`,
      title,
      status: "open",
      choices: [key],
      section,
      part: same.findIndex((s) => s[0] === key) + 1,
      parts: same.length,
      sectionKey: same[0]![0],
      atLevel: 1,
    };
  });
}

describe("planDiff", () => {
  it("does not name a step that went and came back under the same name (AND-100)", () => {
    const d = planDiff(
      flow(["way-1", 0, "Way"], ["bonus-1", 1, "Bonus"], ["lore", 2, "Lore"], ["master", 3, "Master"]),
      flow(["way-2", 0, "Way"], ["bonus-2", 1, "Bonus"], ["calls", 2, "Calls"]),
    );
    expect(d).toEqual({ added: ["Calls"], removed: ["Lore", "Master"], addedParts: [], removedParts: [] });
  });

  it("leaves out the parts of a step that has no answer", () => {
    const before = flow(["class", 0, "Class"], ["folk", 1, "Folk"], ["size", 1, "Size"]);
    const after = flow(["class", 0, "Class"], ["folk", 1, "Folk"], ["roots", 1, "Roots"]);
    expect(planDiff(before, after)).toMatchObject({ addedParts: ["Roots"], removedParts: ["Size"] });
    const asked = (head: FlowEntry) => head.key !== "folk";
    expect(planDiff(before, after, asked)).toMatchObject({ addedParts: [], removedParts: [] });
  });

  it("names the parts a step lost or got when it came back under the same name (AND-138)", () => {
    const before = flow(["class", 0, "Class"], ["order-1", 1, "Order"], ["sub-1", 1, "Branch"]);
    const after = flow(["class", 0, "Class"], ["sub-2", 1, "Branch"], ["lore-2", 1, "Lore"]);
    for (const e of [before[1]!, after[1]!]) e.sectionTitle = "Way";
    expect(planDiff(before, after)).toEqual({
      added: [],
      removed: [],
      addedParts: ["Lore"],
      removedParts: ["Order"],
    });
    expect(planDiff(before, after, () => false)).toMatchObject({ addedParts: [], removedParts: [] });
  });
});
