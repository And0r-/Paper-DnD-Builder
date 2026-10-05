import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { applyChange, evaluateDraft, explainValue, newDraft, totalOf, type DraftDocument } from "./index.ts";

let pkg: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
});

function build(p: ContentPackage, level: number, changes: [string, unknown][]): DraftDocument {
  const start = newDraft(p, level);
  if (!start.ok) throw new Error(JSON.stringify(start.error));
  let doc = start.doc;
  for (const [choice, answer] of changes) {
    const r = applyChange(p, doc, { type: "answer", choice, answer });
    if (!r.ok) throw new Error(`${choice}: ${JSON.stringify(r.error)}`);
    doc = r.doc;
  }
  return doc;
}

const LANTERN_BEARER: [string, unknown][] = [
  ["folk", { pick: "folk.hillfolk" }],
  ["upbringing", { pick: "upbringing.ferry-child" }],
  ["calling", { pick: "calling.lantern-bearer" }],
  ["gear", { pick: "item.reed-shield" }],
  ["scores", { method: 0, assign: { might: 8, grace: 7, wit: 9, heart: 11 } }],
];

describe("explainValue", () => {
  it("shows the answer and a thing's gift that add up to a score", () => {
    const ev = evaluateDraft(pkg, build(pkg, 1, LANTERN_BEARER));
    expect(ev.inputs["grace"]).toEqual({ amount: 7, choice: "scores" });
    expect(explainValue(pkg, ev, "grace")).toEqual({
      total: 8,
      parts: [
        { amount: 7, source: { kind: "choice", choice: "scores" } },
        { amount: 1, source: { kind: "thing", thing: "upbringing.ferry-child" } },
      ],
    });
  });

  it("names every thing that adds to a value and leaves out parts that add nothing", () => {
    const ev = evaluateDraft(pkg, build(pkg, 3, LANTERN_BEARER));
    // stamina = mightBonus (0) * level + 8 + 5 + 5 from the calling + 2 from the folk, in flow order.
    expect(explainValue(pkg, ev, "stamina")).toEqual({
      total: 20,
      parts: [
        { amount: 18, source: { kind: "thing", thing: "calling.lantern-bearer" } },
        { amount: 2, source: { kind: "thing", thing: "folk.hillfolk" } },
      ],
    });
  });

  it("splits a formula into its start and the values it adds", () => {
    const ev = evaluateDraft(pkg, build(pkg, 1, LANTERN_BEARER));
    // guard = 6 + graceBonus (floor(8/3) - 2 = 0) + 2 from the reed shield.
    expect(explainValue(pkg, ev, "guard")?.parts).toEqual([
      { amount: 6, source: { kind: "start" } },
      { amount: 2, source: { kind: "thing", thing: "item.reed-shield" } },
    ]);
  });

  it("gives no explanation when a maximum cut the value", () => {
    // Grace 12 from the scores and 1 from the upbringing, cut to 12.
    const capped = { ...pkg, values: pkg.values.map((v) => (v.id === "grace" ? { ...v, max: 12 } : v)) };
    const ev = evaluateDraft(
      capped,
      build(capped, 1, [
        ...LANTERN_BEARER.slice(0, 4),
        ["scores", { method: 0, assign: { might: 6, grace: 12, wit: 7, heart: 8 } }],
      ]),
    );
    expect(ev.values["grace"]).toBe(12);
    expect(explainValue(capped, ev, "grace")).toBeUndefined();
  });

  it("follows a base and a bonus set in two places to the value that adds them", () => {
    // A package where the sheet shows `total = base + bonus`, the bonus set by a step a thing brings.
    const p: ContentPackage = structuredClone(pkg);
    p.values.push(
      { id: "base", source: "mistland", default: 0 },
      { id: "bonus", source: "mistland", default: 0 },
      { id: "total", source: "mistland", formula: "base + bonus" },
    );
    p.flow.choices.push(
      {
        id: "pick-base",
        kind: "number",
        source: "mistland",
        target: "base",
        min: 1,
        max: 20,
      } as ContentPackage["flow"]["choices"][number],
      {
        id: "pick-bonus",
        kind: "number",
        source: "mistland",
        target: "bonus",
        min: 0,
        max: 2,
      } as ContentPackage["flow"]["choices"][number],
    );
    p.flow.steps.push({ id: "pick-base", choices: ["pick-base"] });
    const folk = p.things.find((t) => t.id === "folk.moorfolk")!;
    folk.grants = [...(folk.grants ?? []), { choice: "pick-bonus" }];

    expect(totalOf(p, "base")).toBe("total");
    expect(totalOf(p, "might")).toBeUndefined();

    const ev = evaluateDraft(
      p,
      build(p, 1, [
        ["folk", { pick: "folk.moorfolk" }],
        ["pick-bonus", { value: 2 }],
        ["pick-base", { value: 15 }],
      ]),
    );
    expect(explainValue(p, ev, "total")).toEqual({
      total: 17,
      parts: [
        { amount: 15, source: { kind: "choice", choice: "pick-base" } },
        { amount: 2, source: { kind: "choice", choice: "pick-bonus" } },
      ],
    });
    expect(ev.steps.find((s) => s.id === "pick-bonus")?.grantedBy).toEqual(["folk.moorfolk"]);
  });

  describe("a guard that is the best of a few ways to wear gear", () => {
    // Like gear that sets the number outright, or adds to a bonus; a calling adds 1 to any of them.
    let p: ContentPackage;
    beforeAll(() => {
      p = structuredClone(pkg);
      p.values.find((v) => v.id === "guard")!.formula =
        "max(6 + graceBonus, if(has('item.travel-cloak'), 9, 0), if(has('item.reed-shield'), 7 + graceBonus, 0))";
      for (const id of ["item.travel-cloak", "item.reed-shield"])
        p.things.find((t) => t.id === id)!.grants = [];
      const calling = p.things.find((t) => t.id === "calling.lantern-bearer")!;
      calling.grants = [
        ...(calling.grants ?? []),
        { value: "guard", add: "if(has('item.travel-cloak') or has('item.reed-shield'), 1, 0)" },
      ];
    });
    const lanternBearer = (gear: string, grace: number): [string, unknown][] => [
      ...LANTERN_BEARER.slice(0, 3),
      ["gear", { pick: gear }],
      ["scores", { method: 0, assign: { might: 6, grace, wit: 7, heart: 8 } }],
    ];

    it("names the gear whose branch won, not the values the other branches use", () => {
      const ev = evaluateDraft(p, build(p, 1, lanternBearer("item.travel-cloak", 10)));
      expect(ev.values["guard"]).toBe(10);
      expect(explainValue(p, ev, "guard")?.parts).toEqual([
        { amount: 9, source: { kind: "thing", thing: "item.travel-cloak" } },
        { amount: 1, source: { kind: "thing", thing: "calling.lantern-bearer" } },
      ]);
    });

    it("splits the winning branch into the gear's number and the bonus it adds", () => {
      const ev = evaluateDraft(p, build(p, 1, lanternBearer("item.reed-shield", 10)));
      // graceBonus = floor((10 + 1) / 3) - 2 = 1; max(7, 0, 7 + 1) + 1 = 9.
      expect(ev.values["guard"]).toBe(9);
      expect(explainValue(p, ev, "guard")?.parts).toEqual([
        { amount: 7, source: { kind: "thing", thing: "item.reed-shield" } },
        { amount: 1, source: { kind: "values", values: ["graceBonus"] } },
        { amount: 1, source: { kind: "thing", thing: "calling.lantern-bearer" } },
      ]);
    });

    it("gives no source rather than a wrong one when two branches tie", () => {
      const q = structuredClone(p);
      q.values.find((v) => v.id === "guard")!.formula =
        "max(6 + graceBonus, if(has('item.travel-cloak'), 7, 0))";
      const ev = evaluateDraft(q, build(q, 1, lanternBearer("item.travel-cloak", 10)));
      expect(explainValue(q, ev, "guard")?.parts).toEqual([
        { amount: 7, source: { kind: "unclear" } },
        { amount: 1, source: { kind: "thing", thing: "calling.lantern-bearer" } },
      ]);
    });
  });
});
