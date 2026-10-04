import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyChange,
  evaluateDraft,
  newDraft,
  summarize,
  type DraftChange,
  type DraftDocument,
} from "./index.ts";

// All rules here come from the demo package; the core itself knows none of them.
let pkg: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
});

function draft(level: number, answers: Record<string, unknown> = {}): DraftDocument {
  return { level, answers };
}

/** Applies changes one by one, failing loudly if one is rejected. */
function build(level: number, changes: [string, unknown][]): DraftDocument {
  const start = newDraft(pkg, level);
  if (!start.ok) throw new Error(JSON.stringify(start.error));
  let doc = start.doc;
  for (const [choice, answer] of changes) {
    const change: DraftChange = { type: "answer", choice, answer };
    const r = applyChange(pkg, doc, change);
    if (!r.ok) throw new Error(`${choice}: ${JSON.stringify(r.error)}`);
    doc = r.doc;
  }
  return doc;
}

const LANTERN_BEARER_L3: [string, unknown][] = [
  ["folk", { pick: "folk.moorfolk" }],
  ["upbringing", { pick: "upbringing.ferry-child" }],
  ["calling", { pick: "calling.lantern-bearer" }],
  ["talents-lantern-bearer", { picks: ["talent.mending", "talent.climbing"] }],
  ["gear", { pick: "item.reed-shield" }],
  ["knacks-lantern", { picks: ["knack.warm-glow", "knack.glow-thread", "knack.quiet-word"] }],
  ["path", { pick: "path.lightwarden" }],
  ["scores", { method: 0, assign: { might: 8, grace: 7, wit: 9, heart: 11 } }],
  ["extra-talent", { pick: "talent.listening" }],
  ["name", { text: "Mira Fennwick" }],
  ["age", { value: 24 }],
];

describe("steps", () => {
  it("lists the flow's steps for a new level 1 draft and hides steps whose condition is false", () => {
    const ev = evaluateDraft(pkg, draft(1));
    expect(ev.steps.map((s) => s.id)).toEqual([
      "character",
      "calling",
      "calling-gifts",
      "upbringing",
      "folk",
      "scores",
      "looks",
    ]);
    expect(ev.complete).toBe(false);
    expect(ev.open).toEqual(["name", "calling", "upbringing", "folk", "scores", "age"]);
  });

  it("shows level-dependent steps from their level on", () => {
    expect(evaluateDraft(pkg, draft(2)).steps.map((s) => s.id)).toContain("extra-talent");
  });

  it("inserts granted choices right after the step that granted them, in grant order", () => {
    const ev = evaluateDraft(pkg, draft(3, { calling: { pick: "calling.lantern-bearer" } }));
    expect(ev.steps.map((s) => s.id)).toEqual([
      "character",
      "calling",
      "talents-lantern-bearer",
      "gear",
      "knacks-lantern",
      "path",
      "calling-gifts",
      "upbringing",
      "folk",
      "scores",
      "extra-talent",
      "looks",
    ]);
    const talents = ev.steps.find((s) => s.id === "talents-lantern-bearer")!;
    expect(talents.origin).toBe("granted");
    expect(talents.grantedBy).toEqual(["calling.lantern-bearer"]);
    expect(talents.dependsOn).toEqual(["calling"]);
  });

  it("asks a choice granted at a higher level only from that level on", () => {
    const ev = evaluateDraft(pkg, draft(2, { calling: { pick: "calling.lantern-bearer" } }));
    expect(ev.steps.map((s) => s.id)).not.toContain("path");
  });
});

describe("options", () => {
  it("does not offer things the character already has from elsewhere", () => {
    const ev = evaluateDraft(
      pkg,
      draft(2, {
        calling: { pick: "calling.lantern-bearer" },
        "talents-lantern-bearer": { picks: ["talent.climbing", "talent.mending"] },
        upbringing: { pick: "upbringing.ferry-child" },
      }),
    );
    // Climbing and mending come with the calling, weather sense and haggling
    // with the upbringing, so the extra talent does not offer them again.
    const options = ev.choices["extra-talent"]!.options;
    expect(options).toContain("talent.legends");
    for (const had of ["talent.climbing", "talent.mending", "talent.weather-sense", "talent.haggling"]) {
      expect(options).not.toContain(had);
    }
  });

  it("offers only things whose condition holds", () => {
    const ev = evaluateDraft(pkg, draft(3, { calling: { pick: "calling.lantern-bearer" } }));
    expect(ev.choices["path"]!.options).toEqual(["path.lightwarden"]);
    expect(ev.choices["gear"]!.options).toEqual([
      "item.travel-cloak",
      "item.reed-shield",
      "item.trail-boots",
    ]);
    expect(ev.choices["knacks-lantern"]!.options).toContain("knack.light-bridge");
    const l1 = evaluateDraft(pkg, draft(1, { calling: { pick: "calling.lantern-bearer" } }));
    expect(l1.choices["knacks-lantern"]!.options).not.toContain("knack.light-bridge");
  });

  it("computes counts from expressions and picks the first recommendation that applies", () => {
    const l1 = evaluateDraft(pkg, draft(1, { calling: { pick: "calling.lantern-bearer" } }));
    const l3 = evaluateDraft(pkg, draft(3, { calling: { pick: "calling.lantern-bearer" } }));
    expect(l1.choices["knacks-lantern"]!.count).toBe(2);
    expect(l3.choices["knacks-lantern"]!.count).toBe(3);
    expect(l1.choices["knacks-lantern"]!.recommended).toEqual(["knack.warm-glow", "knack.glow-thread"]);
    expect(l3.choices["scores"]!.recommended).toEqual({
      method: 0,
      assign: { might: 8, grace: 7, wit: 9, heart: 11 },
    });
  });
});

describe("a complete level 3 character", () => {
  it("is complete and has every value computed from the package's formulas", () => {
    const doc = build(3, LANTERN_BEARER_L3);
    const ev = evaluateDraft(pkg, doc);

    expect(ev.open).toEqual([]);
    expect(ev.complete).toBe(true);
    expect(ev.steps.every((s) => s.status === "done")).toBe(true);
    // stamina: mightBonus (floor(8/3)-2 = 0) * level + 8 + 5 + 5 from the calling.
    expect(ev.values["stamina"]).toBe(18);
    // guard: 6 + graceBonus (0) + 2 reed shield + 1 warding glow from the path.
    expect(ev.values["guard"]).toBe(9);
    expect(ev.values["pace"]).toBe(25);
    expect(ev.values["heartBonus"]).toBe(1);
    expect(ev.values["luck"]).toBe(2);
    // nerve: 1 + floor(3/2) + max(witBonus 1, heartBonus 1)
    expect(ev.values["nerve"]).toBe(3);
    expect(ev.values["carry"]).toBe(40);
    expect(ev.values["age"]).toBe(24);
  });

  it("gives granted things, including those granted by granted things", () => {
    const ev = evaluateDraft(pkg, build(3, LANTERN_BEARER_L3));
    const ids = ev.things.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "trait.mist-sight",
        "talent.haggling",
        "item.lantern-staff",
        "trait.steady-flame",
        "trait.warding-glow",
        "knack.lantern-call",
        "talent.listening",
      ]),
    );
    expect(ev.things.find((t) => t.id === "knack.lantern-call")).toMatchObject({
      grantedBy: "path.lightwarden",
      step: "path",
    });
  });

  it("describes what the calling gives on its info step", () => {
    const ev = evaluateDraft(pkg, build(3, LANTERN_BEARER_L3));
    expect(ev.choices["calling-gifts"]!.info).toEqual({
      of: "calling",
      thing: "calling.lantern-bearer",
      things: ["item.lantern-staff", "item.provisions", "trait.steady-flame"],
      values: [{ value: "stamina", add: 18 }],
      choices: ["talents-lantern-bearer", "gear", "knacks-lantern", "path"],
    });
  });

  it("works out an info step's value changes with the values of later steps", () => {
    // The calling's grant uses heart, which is only set on the later scores step.
    const withFormula: ContentPackage = {
      ...pkg,
      things: pkg.things.map((t) =>
        t.id === "calling.lantern-bearer"
          ? { ...t, grants: [...(t.grants ?? []), { value: "stamina", add: "heartBonus * level" }] }
          : t,
      ),
    };
    const ev = evaluateDraft(withFormula, build(3, LANTERN_BEARER_L3));
    const bonus = ev.values["heartBonus"]!;
    expect(bonus).not.toBe(evaluateDraft(withFormula, draft(3)).values["heartBonus"]);
    expect(ev.choices["calling-gifts"]!.info!.values).toEqual([{ value: "stamina", add: 18 + bonus * 3 }]);
  });

  it("summarizes name and summary line", () => {
    const doc = build(3, LANTERN_BEARER_L3);
    expect(summarize(pkg, doc, evaluateDraft(pkg, doc))).toEqual({
      name: "Mira Fennwick",
      level: 3,
      complete: true,
      line: { calling: "calling.lantern-bearer", level: 3 },
    });
  });
});

describe("changing earlier answers", () => {
  it("keeps answers that no longer apply, marks them, and restores them when going back", () => {
    const doc = build(3, LANTERN_BEARER_L3);
    const switched = applyChange(pkg, doc, {
      type: "answer",
      choice: "calling",
      answer: { pick: "calling.herbalist" },
    });
    if (!switched.ok) throw new Error("rejected");
    const ev = evaluateDraft(pkg, switched.doc);

    expect(ev.inactiveAnswers).toEqual(expect.arrayContaining(["talents-lantern-bearer", "knacks-lantern"]));
    expect(ev.choices["talents-herbalist"]!.status).toBe("missing");
    // The reed shield needs another calling: the pick is kept but no longer counts.
    expect(ev.choices["gear"]).toMatchObject({ status: "invalid", problem: "notOffered" });
    expect(ev.values["guard"]).toBe(6);
    expect(ev.steps.find((s) => s.id === "gear")!.status).toBe("needsAttention");
    expect(ev.complete).toBe(false);

    const back = applyChange(pkg, switched.doc, {
      type: "answer",
      choice: "calling",
      answer: { pick: "calling.lantern-bearer" },
    });
    if (!back.ok) throw new Error("rejected");
    expect(evaluateDraft(pkg, back.doc).complete).toBe(true);
  });

  it("re-evaluates when the level goes down", () => {
    const r = applyChange(pkg, build(3, LANTERN_BEARER_L3), { type: "setLevel", level: 1 });
    if (!r.ok) throw new Error("rejected");
    const ev = evaluateDraft(pkg, r.doc);
    expect(ev.choices["knacks-lantern"]).toMatchObject({ status: "invalid", problem: "tooMany", count: 2 });
    expect(ev.inactiveAnswers).toEqual(expect.arrayContaining(["path", "extra-talent"]));
    expect(ev.things.map((t) => t.id)).not.toContain("trait.steady-flame");
    expect(ev.values["stamina"]).toBe(8);
  });
});

describe("applyChange", () => {
  const base = () => build(1, [["calling", { pick: "calling.river-runner" }]]);

  it("rejects a level outside the package's range", () => {
    expect(applyChange(pkg, base(), { type: "setLevel", level: 4 })).toEqual({
      ok: false,
      error: { code: "levelOutOfRange", min: 1, max: 3 },
    });
    expect(newDraft(pkg, 0).ok).toBe(false);
  });

  it("rejects unknown choices, choices not asked now and answers to info steps", () => {
    const doc = base();
    const err = (choice: string, answer: unknown) => {
      const r = applyChange(pkg, doc, { type: "answer", choice, answer });
      return r.ok ? undefined : r.error;
    };
    expect(err("nope", { pick: "x" })).toEqual({ code: "unknownChoice" });
    expect(err("path", { pick: "path.ferrymaster" })).toEqual({ code: "notAsked" });
    expect(err("calling-gifts", { pick: "x" })).toEqual({ code: "noAnswerNeeded" });
  });

  it("rejects answers that do not fit the choice right now", () => {
    const doc = base();
    const problem = (choice: string, answer: unknown) => {
      const r = applyChange(pkg, doc, { type: "answer", choice, answer });
      return r.ok ? "ok" : r.error.code === "answerDoesNotFit" ? r.error.problem : r.error.code;
    };
    expect(problem("gear", { pick: "item.mortar" })).toBe("notOffered");
    expect(problem("gear", { picks: ["item.rope"] })).toBe("badShape");
    expect(problem("knacks-current", { picks: ["knack.fog-hop", "knack.eddy", "knack.wave-push"] })).toBe(
      "tooMany",
    );
    expect(problem("knacks-current", { picks: ["knack.fog-hop", "knack.fog-hop"] })).toBe("duplicate");
    expect(problem("age", { value: 10 })).toBe("outOfRange");
    expect(problem("name", { text: "   " })).toBe("empty");
    expect(problem("name", { text: "x".repeat(41) })).toBe("tooLong");
    expect(problem("name", { text: "Two\nlines" })).toBe("badCharacters");
    expect(problem("looks", { text: "Tall.\nGreen coat." })).toBe("ok");
    expect(problem("scores", { method: 0, assign: { might: 12, grace: 12, wit: 6, heart: 6 } })).toBe(
      "overBudget",
    );
    expect(problem("scores", { method: 0, assign: { might: 13, grace: 6, wit: 6, heart: 6 } })).toBe(
      "outOfRange",
    );
    expect(problem("scores", { method: 1, assign: { might: 11, grace: 11, wit: 9, heart: 7 } })).toBe(
      "badAssignment",
    );
    expect(problem("scores", { method: 1, assign: { might: 11, grace: 10, wit: 9 } })).toBe("badAssignment");
    expect(problem("scores", { method: 5, assign: { might: 11, grace: 10, wit: 9, heart: 7 } })).toBe(
      "badMethod",
    );
  });

  it("accepts partial picks, but the choice stays open; leftover points are only reported", () => {
    let doc = base();
    for (const [choice, answer] of [
      ["knacks-current", { picks: ["knack.fog-hop"] }],
      ["scores", { method: 0, assign: { might: 8, grace: 8, wit: 8, heart: 8 } }],
    ] as const) {
      const r = applyChange(pkg, doc, { type: "answer", choice, answer });
      if (!r.ok) throw new Error(choice);
      doc = r.doc;
    }
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["knacks-current"]).toMatchObject({ status: "incomplete", remaining: 1 });
    expect(ev.choices["scores"]).toMatchObject({ status: "answered", remaining: 6 });
    expect(ev.values["might"]).toBe(8);
    expect(ev.open).toContain("knacks-current");
    expect(ev.open).not.toContain("scores");
  });

  it("accepts a fixed array of scores", () => {
    const r = applyChange(pkg, base(), {
      type: "answer",
      choice: "scores",
      answer: { method: 1, assign: { might: 7, grace: 11, wit: 10, heart: 9 } },
    });
    if (!r.ok) throw new Error("rejected");
    const ev = evaluateDraft(pkg, r.doc);
    expect(ev.choices["scores"]!.status).toBe("answered");
    expect(ev.values["graceBonus"]).toBe(1);
  });

  it("removes an answer with null", () => {
    const r = applyChange(pkg, base(), { type: "answer", choice: "calling", answer: null });
    if (!r.ok) throw new Error("rejected");
    expect(r.doc.answers).toEqual({});
  });
});
