import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage, type Thing } from "@builder/format";
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
  ["scores", { method: 0, assign: { mightBase: 8, graceBase: 7, witBase: 9, heartBase: 11 } }],
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
      "folk",
      "upbringing",
      "scores",
      "looks",
    ]);
    expect(ev.complete).toBe(false);
    expect(ev.open).toEqual(["name", "calling", "folk", "upbringing", "scores", "age"]);
  });

  it("shows level-dependent steps from their level on", () => {
    const calling = { calling: { pick: "calling.lantern-bearer" } };
    expect(evaluateDraft(pkg, draft(1, calling)).choices["extra-talent"]).toBeUndefined();
    expect(evaluateDraft(pkg, draft(2, calling)).choices["extra-talent"]!.step).toBe("talents");
    // A fixed step with a condition: only river runners handle their things.
    const runner = { calling: { pick: "calling.river-runner" } };
    expect(evaluateDraft(pkg, draft(1, runner)).steps.map((s) => s.id)).toContain("handling-river-runner");
    expect(evaluateDraft(pkg, draft(1, calling)).steps.map((s) => s.id)).not.toContain(
      "handling-river-runner",
    );
  });

  it("asks granted choices at their gather step, in grant order", () => {
    const ev = evaluateDraft(pkg, draft(3, { calling: { pick: "calling.lantern-bearer" } }));
    expect(ev.steps.map((s) => s.id)).toEqual([
      "character",
      "calling",
      "calling-gifts",
      "folk",
      "upbringing",
      "path",
      "scores",
      "talents",
      "knacks",
      "gear",
      "looks",
    ]);
    const gear = ev.steps.find((s) => s.id === "gear")!;
    expect(gear.origin).toBe("granted");
    expect(gear.grantedBy).toEqual(["calling.lantern-bearer"]);
    expect(gear.dependsOn).toEqual(["calling"]);
    // The talents of the calling and of level 2 share one list after the scores.
    const talents = ev.steps.find((s) => s.id === "talents")!;
    expect(talents).toMatchObject({ origin: "flow", gather: { group: "talents", together: "list" } });
    expect(talents.choices).toEqual(["talents-lantern-bearer", "extra-talent"]);
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
        upbringing: { pick: "upbringing.ferry-child" },
      }),
    );
    // Weather sense and haggling come with the upbringing, an earlier step,
    // so the talents step does not offer them again.
    const options = ev.choices["extra-talent"]!.options;
    expect(options).toContain("talent.legends");
    for (const had of ["talent.weather-sense", "talent.haggling"]) {
      expect(options).not.toContain(had);
      expect(ev.steps.find((s) => s.id === "talents")!.pool!.options).not.toContain(had);
    }
  });

  it("offers only things whose condition holds", () => {
    const ev = evaluateDraft(pkg, draft(3, { calling: { pick: "calling.lantern-bearer" } }));
    expect(ev.choices["path"]!.options).toEqual(["path.lightwarden"]);
    expect(ev.choices["gear"]!.options).toEqual([
      "item.travel-cloak",
      "item.reed-shield",
      "item.trail-boots",
      "item.sling",
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
      assign: { mightBase: 8, graceBase: 7, witBase: 9, heartBase: 11 },
    });
  });

  it("counts a tag from an earlier answer and switches to the text variant whose condition holds", () => {
    const calling = { pick: "calling.river-runner" };
    const moor = evaluateDraft(pkg, draft(1, { folk: { pick: "folk.moorfolk" }, calling }));
    const hill = evaluateDraft(pkg, draft(1, { folk: { pick: "folk.hillfolk" }, calling }));
    expect(moor.choices["talents-river-runner"]).toMatchObject({ count: 2 });
    expect(moor.choices["talents-river-runner"]!.textVariant).toBeUndefined();
    expect(moor.choices["talents-river-runner"]!.recommended).toHaveLength(2);
    expect(hill.choices["talents-river-runner"]).toMatchObject({ count: 3, textVariant: "hillfolk" });
    expect(hill.choices["talents-river-runner"]!.recommended).toHaveLength(3);
  });

  it("resolves badges to text keys by offered option", () => {
    const ev = evaluateDraft(pkg, draft(1, {}));
    expect(ev.choices["calling"]!.badges).toEqual({
      "calling.lantern-bearer": "choice.calling.badge.gentle",
    });
    expect(ev.choices["folk"]!.badges).toBeUndefined();
  });

  it("resolves row badges of a distribute choice by target, while their condition holds", () => {
    const lantern = evaluateDraft(pkg, draft(1, { calling: { pick: "calling.lantern-bearer" } }));
    expect(lantern.choices["scores"]!.badges).toEqual({
      heartBase: "choice.scores.badge.lantern-bearer",
      witBase: "choice.scores.badge.lantern-bearer",
    });
    const herbalist = evaluateDraft(pkg, draft(1, { calling: { pick: "calling.herbalist" } }));
    expect(herbalist.choices["scores"]!.badges).toBeUndefined();
  });

  describe("held", () => {
    const riverRunner = (answers: Record<string, unknown>, p: ContentPackage = pkg) =>
      evaluateDraft(p, draft(1, { calling: { pick: "calling.river-runner" }, ...answers }));

    it("names what the character has and recommends the options about it first", () => {
      const ev = riverRunner({ gear: { pick: "item.trail-boots" } });
      const handling = ev.choices["handling-river-runner"]!;
      expect(handling.held).toEqual(["item.boat-hook", "item.trail-boots"]);
      expect(handling.recommended).toEqual(["handling.boat-hook", "handling.trail-boots"]);
      // Changing the gear changes this step.
      const step = ev.steps.find((s) => s.id === "handling-river-runner")!;
      expect(new Set(step.dependsOn)).toEqual(new Set(["calling", "gear"]));
    });

    it("fills the remaining places with the package's recommendation", () => {
      const handling = riverRunner({}).choices["handling-river-runner"]!;
      expect(handling.held).toEqual(["item.boat-hook"]);
      expect(handling.recommended).toEqual(["handling.boat-hook", "handling.rope"]);
    });

    it("recommends no more than are asked for, in option order", () => {
      // Three fit, but only two are asked for: "choose for me" must give a valid answer.
      const withBell: ContentPackage = {
        ...pkg,
        things: pkg.things.map((t) =>
          t.id === "calling.river-runner"
            ? { ...t, grants: [...(t.grants ?? []), { thing: "item.small-bell" }] }
            : t,
        ),
      };
      const handling = riverRunner({ gear: { pick: "item.trail-boots" } }, withBell).choices[
        "handling-river-runner"
      ]!;
      expect(handling.held).toEqual(["item.boat-hook", "item.small-bell", "item.trail-boots"]);
      expect(handling.recommended).toEqual(["handling.boat-hook", "handling.small-bell"]);
    });

    it("keeps the package's own pick among them when more fit than are asked for", () => {
      // Bell, boots and hook fit; the package recommends the boots, so they stay in.
      const p: ContentPackage = {
        ...pkg,
        things: pkg.things.map((t) =>
          t.id === "calling.river-runner"
            ? { ...t, grants: [...(t.grants ?? []), { thing: "item.small-bell" }] }
            : t,
        ),
        flow: {
          ...pkg.flow,
          choices: pkg.flow.choices.map((c) =>
            c.id === "handling-river-runner" && c.kind === "pickMany"
              ? { ...c, recommend: [{ pick: ["handling.trail-boots", "handling.rope"] }] }
              : c,
          ),
        },
      };
      const handling = riverRunner({ gear: { pick: "item.trail-boots" } }, p).choices[
        "handling-river-runner"
      ]!;
      expect(handling.recommended).toEqual(["handling.trail-boots", "handling.boat-hook"]);
    });

    it("counts only what earlier steps brought", () => {
      const bell = { upbringing: { pick: "upbringing.bell-tower" } };
      // The handling step comes after the upbringing, so its bell counts.
      const ev = riverRunner(bell);
      expect(ev.choices["handling-river-runner"]!.held).toEqual(["item.boat-hook", "item.small-bell"]);
      const step = ev.steps.find((s) => s.id === "handling-river-runner")!;
      expect(step.dependsOn).toEqual(["calling", "upbringing"]);
      // Asked before the upbringing, the bell is not there yet.
      const early: ContentPackage = structuredClone(pkg);
      const steps = early.flow.steps;
      const handling = steps.splice(
        steps.findIndex((s) => s.id === "handling-river-runner"),
        1,
      )[0]!;
      steps.splice(
        steps.findIndex((s) => s.id === "folk"),
        0,
        handling,
      );
      expect(riverRunner(bell, early).choices["handling-river-runner"]!.held).toEqual(["item.boat-hook"]);
    });

    it("is left out on choices without it", () => {
      expect(riverRunner({}).choices["talents-river-runner"]!.held).toBeUndefined();
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
      counts: { "item.provisions": 3 },
      values: [
        { value: "stamina", add: 18 },
        { value: "lanternSlots1", add: 2 },
        { value: "lanternSlots2", add: 1 },
      ],
      choices: ["talents-lantern-bearer", "gear", "knacks-lantern", "extra-talent", "path"],
    });
  });

  it("asks an info step's choices before it, unless a gather group moves them later", () => {
    // The flow words them as already chosen, or as chosen later at their step; never as coming next.
    const ev = evaluateDraft(pkg, build(3, LANTERN_BEARER_L3));
    const order = ev.steps.map((s) => s.id);
    const infoAt = order.indexOf(ev.choices["calling-gifts"]!.step);
    const gathered = (c: string) => pkg.flow.choices.find((x) => x.id === c)?.gather !== undefined;
    for (const c of ev.choices["calling-gifts"]!.info!.choices) {
      const at = order.indexOf(ev.choices[c]!.step);
      expect(at < infoAt || gathered(c)).toBe(true);
      expect(ev.choices[c]!.status).toBe("answered");
    }
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
    expect(ev.choices["calling-gifts"]!.info!.values[0]).toEqual({ value: "stamina", add: 18 + bonus * 3 });
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
    expect(applyChange(pkg, base(), { type: "setLevel", level: 21 })).toEqual({
      ok: false,
      error: { code: "levelOutOfRange", min: 1, max: 20 },
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
    expect(
      problem("scores", { method: 0, assign: { mightBase: 12, graceBase: 12, witBase: 6, heartBase: 6 } }),
    ).toBe("overBudget");
    expect(
      problem("scores", { method: 0, assign: { mightBase: 13, graceBase: 6, witBase: 6, heartBase: 6 } }),
    ).toBe("outOfRange");
    expect(
      problem("scores", { method: 1, assign: { mightBase: 11, graceBase: 11, witBase: 9, heartBase: 7 } }),
    ).toBe("badAssignment");
    expect(problem("scores", { method: 1, assign: { mightBase: 11, graceBase: 10, witBase: 9 } })).toBe(
      "badAssignment",
    );
    expect(
      problem("scores", { method: 5, assign: { mightBase: 11, graceBase: 10, witBase: 9, heartBase: 7 } }),
    ).toBe("badMethod");
  });

  it("accepts partial picks, but the choice stays open; leftover points are only reported", () => {
    let doc = base();
    for (const [choice, answer] of [
      ["knacks-current", { picks: ["knack.fog-hop"] }],
      ["scores", { method: 0, assign: { mightBase: 8, graceBase: 8, witBase: 8, heartBase: 8 } }],
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
      answer: { method: 1, assign: { mightBase: 7, graceBase: 11, witBase: 10, heartBase: 9 } },
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

describe("counts (format 0.13)", () => {
  /** The demo package with the lantern bearer's grants changed by `edit`. */
  const withGrants = (edit: (grants: NonNullable<Thing["grants"]>) => void): ContentPackage => ({
    ...pkg,
    things: pkg.things.map((t) => {
      if (t.id !== "calling.lantern-bearer") return t;
      const grants = structuredClone(t.grants ?? []);
      edit(grants);
      return { ...t, grants };
    }),
  });
  const held = (p: ContentPackage, id: string) =>
    evaluateDraft(p, build(3, LANTERN_BEARER_L3)).things.find((h) => h.id === id);

  it("adds up the counts of every grant that gives a thing", () => {
    // 3 provisions from the lantern bearer, 2 from the ferry child.
    expect(held(pkg, "item.provisions")).toMatchObject({ grantedBy: "calling.lantern-bearer", count: 5 });
    // A grant without a count gives one of a counted thing.
    const one = withGrants((g) => delete g.find((x) => x.thing === "item.provisions")!.count);
    expect(held(one, "item.provisions")?.count).toBe(3);
  });

  it("does not count a thing no grant gives with a count: twice is still once", () => {
    expect(held(pkg, "item.rope")?.count).toBeUndefined();
    const twice = withGrants((g) => g.push({ thing: "item.rope" }));
    expect(held(twice, "item.rope")?.count).toBeUndefined();
    const counted = withGrants((g) => g.push({ thing: "item.rope", count: 2 }));
    expect(held(counted, "item.rope")?.count).toBe(3);
  });

  it("does not let a count change has() or count()", () => {
    const many = withGrants((g) => (g.find((x) => x.thing === "item.provisions")!.count = 40));
    const doc = build(3, LANTERN_BEARER_L3);
    expect(evaluateDraft(many, doc).values).toEqual(evaluateDraft(pkg, doc).values);
  });
});

describe("a pick that a later step grants anyway", () => {
  // The coastfolk's flair is asked right after the folk; the bell tower
  // upbringing (a later step) grants the flair "listening".
  const coast: [string, unknown][] = [
    ["folk", { pick: "folk.coastfolk" }],
    ["coastfolk-flair", { pick: "flair.listening" }],
  ];

  it("marks the earlier pick as a duplicate and asks its step again", () => {
    const doc = build(1, [...coast, ["upbringing", { pick: "upbringing.bell-tower" }]]);
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["coastfolk-flair"]).toMatchObject({
      status: "invalid",
      problem: "duplicate",
      givenBy: { "flair.listening": "upbringing.bell-tower" },
      options: ["flair.haggling"],
    });
    expect(ev.steps.find((s) => s.id === "coastfolk-flair")?.status).toBe("needsAttention");
    expect(ev.open).toContain("coastfolk-flair");
    // The character has the flair once, from the upbringing.
    expect(ev.things.filter((h) => h.id === "flair.listening")).toEqual([
      expect.objectContaining({ grantedBy: "upbringing.bell-tower", step: "upbringing" }),
    ]);
  });

  it("does not offer it when the later grant is known already, in either step order", () => {
    const answers = { folk: { pick: "folk.coastfolk" }, upbringing: { pick: "upbringing.bell-tower" } };
    expect(evaluateDraft(pkg, draft(1, answers)).choices["coastfolk-flair"]?.options).toEqual([
      "flair.haggling",
    ]);
    const later = applyChange(pkg, draft(1, answers), {
      type: "answer",
      choice: "coastfolk-flair",
      answer: { pick: "flair.listening" },
    });
    expect(later.ok ? "ok" : later.error).toEqual({ code: "answerDoesNotFit", problem: "notOffered" });
    // Upbringing first: the flair is held already when the folk's step comes.
    const swapped: ContentPackage = {
      ...pkg,
      flow: {
        ...pkg.flow,
        steps: pkg.flow.steps.map((s) =>
          s.id === "folk"
            ? pkg.flow.steps.find((u) => u.id === "upbringing")!
            : s.id === "upbringing"
              ? pkg.flow.steps.find((f) => f.id === "folk")!
              : s,
        ),
      },
    };
    const ev = evaluateDraft(
      swapped,
      draft(1, { ...answers, "coastfolk-flair": { pick: "flair.listening" } }),
    );
    expect(ev.choices["coastfolk-flair"]).toMatchObject({ status: "invalid", options: ["flair.haggling"] });
  });

  it("keeps a pick the later step does not grant", () => {
    const doc = build(1, [
      ["folk", { pick: "folk.coastfolk" }],
      ["coastfolk-flair", { pick: "flair.haggling" }],
      ["upbringing", { pick: "upbringing.bell-tower" }],
    ]);
    const ev = evaluateDraft(pkg, doc);
    expect(ev.choices["coastfolk-flair"]).toMatchObject({ status: "answered" });
    expect(ev.choices["coastfolk-flair"]?.givenBy).toBeUndefined();
  });

  it("keeps the pick of a repeatable thing: it counts twice", () => {
    const repeatable: ContentPackage = {
      ...pkg,
      things: pkg.things.map((t) => (t.id === "flair.listening" ? { ...t, repeatable: true } : t)),
    };
    const doc = build(1, [...coast, ["upbringing", { pick: "upbringing.bell-tower" }]]);
    const ev = evaluateDraft(repeatable, doc);
    expect(ev.choices["coastfolk-flair"]).toMatchObject({ status: "answered" });
    expect(ev.choices["coastfolk-flair"]?.options).toContain("flair.listening");
  });
});
