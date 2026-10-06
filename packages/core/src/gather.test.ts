import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type Choice, type ContentPackage, type Step } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import { applyChange, evaluateDraft, newDraft, type DraftChange, type DraftDocument } from "./index.ts";

// Gather steps (SPEC 9.4) on a variant of the demo package: the lantern
// bearer's talents and an invented extra talent of the hillfolk are granted
// choices with the gather group "talents", asked at a step after the upbringing.
let demo: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  demo = r.package;
});

interface Variant {
  together?: "sections" | "list";
  /** Index in the demo's steps where the gather step goes; default right after the upbringing. */
  at?: number;
  when?: string;
}

function variant({ together, at, when }: Variant = {}): ContentPackage {
  const pkg = structuredClone(demo);
  const flow = pkg.flow;
  const talents = flow.choices.find((c) => c.id === "talents-lantern-bearer") as Extract<
    Choice,
    { kind: "pickMany" }
  >;
  talents.count = 2;
  const folkTalent: Choice = {
    id: "folk-talent",
    kind: "pickMany",
    source: "mistland",
    options: { kind: "talent" },
    count: 1,
    recommend: [{ pick: ["talent.mending"] }],
    gather: "talents",
  };
  flow.choices.push(folkTalent);
  // The demo's own talents step is replaced by one with the options under test.
  flow.steps = flow.steps.filter((s) => s.id !== "talents");
  const step: Step = {
    id: "talents",
    gather: "talents",
    ...(together ? { together } : {}),
    ...(when ? { when } : {}),
  };
  flow.steps.splice(at ?? flow.steps.findIndex((s) => s.id === "upbringing") + 1, 0, step);
  pkg.things.find((t) => t.id === "folk.hillfolk")!.grants!.push({ choice: "folk-talent" });
  return pkg;
}

function build(pkg: ContentPackage, changes: (DraftChange | [string, unknown])[], level = 1): DraftDocument {
  const start = newDraft(pkg, level);
  if (!start.ok) throw new Error(JSON.stringify(start.error));
  let doc = start.doc;
  for (const c of changes) {
    const change: DraftChange = Array.isArray(c) ? { type: "answer", choice: c[0], answer: c[1] } : c;
    const r = applyChange(pkg, doc, change);
    if (!r.ok) throw new Error(`${JSON.stringify(change)}: ${JSON.stringify(r.error)}`);
    doc = r.doc;
  }
  return doc;
}

const LANTERN_HILLFOLK: [string, unknown][] = [
  ["calling", { pick: "calling.lantern-bearer" }],
  ["upbringing", { pick: "upbringing.ferry-child" }],
  ["folk", { pick: "folk.hillfolk" }],
];

/** What the folk talent offers on the list step: every talent the character does not have yet, in package order. */
const FOLK_TALENTS = [
  "talent.climbing",
  "talent.tracking",
  "talent.mending",
  "talent.listening",
  "talent.legends",
  "talent.sneaking",
];

const pool = (step: string, picks: string[]): DraftChange => ({ type: "pool", step, picks });

describe("gather steps", () => {
  it("asks a gathered choice at its gather step, not after the step that grants it", () => {
    const pkg = variant();
    const ev = evaluateDraft(pkg, build(pkg, LANTERN_HILLFOLK));
    expect(ev.steps.map((s) => s.id)).toEqual([
      "character",
      "calling",
      "calling-gifts",
      "folk",
      "upbringing",
      "talents-lantern-bearer",
      "folk-talent",
      "scores",
      "knacks",
      "gear",
      "looks",
    ]);
    const talents = ev.steps.find((s) => s.id === "talents-lantern-bearer")!;
    expect(talents.origin).toBe("granted");
    expect(talents.grantedBy).toEqual(["calling.lantern-bearer"]);
    expect(talents.dependsOn).toEqual(["calling"]);
    expect(talents.gather).toBeUndefined();
    expect(ev.choices["folk-talent"]!.grantedBy).toEqual(["folk.hillfolk"]);
  });

  it("does not show a gather step that gathered nothing", () => {
    const pkg = variant({ together: "list" });
    // Before a calling is picked, nothing grants a talent choice yet.
    const ev = evaluateDraft(pkg, build(pkg, [["folk", { pick: "folk.moorfolk" }]]));
    expect(ev.steps.map((s) => s.id)).not.toContain("talents");
  });

  it("falls back to right after the granting step when the gather step came earlier", () => {
    const pkg = variant({ together: "list", at: 1 });
    const ev = evaluateDraft(pkg, build(pkg, LANTERN_HILLFOLK));
    expect(ev.steps.map((s) => s.id)).toEqual([
      "character",
      "calling",
      "talents-lantern-bearer",
      "calling-gifts",
      "folk",
      "folk-talent",
      "upbringing",
      "scores",
      "knacks",
      "gear",
      "looks",
    ]);
  });

  it("asks the gathered choices one by one at a hidden gather step", () => {
    const pkg = variant({ together: "list", when: "level >= 2" });
    const ev = evaluateDraft(pkg, build(pkg, LANTERN_HILLFOLK));
    expect(ev.steps.map((s) => s.id)).toContain("folk-talent");
    expect(ev.steps.map((s) => s.id)).not.toContain("talents");
  });

  it("shows all gathered choices on one step with `sections`", () => {
    const pkg = variant({ together: "sections" });
    const doc = build(pkg, [
      ...LANTERN_HILLFOLK,
      ["talents-lantern-bearer", { picks: ["talent.climbing", "talent.mending"] }],
    ]);
    const ev = evaluateDraft(pkg, doc);
    const step = ev.steps.find((s) => s.id === "talents")!;
    expect(step.choices).toEqual(["talents-lantern-bearer", "folk-talent"]);
    expect(step.origin).toBe("flow");
    expect(step.gather).toEqual({ group: "talents", together: "sections" });
    expect(step.grantedBy).toEqual(["calling.lantern-bearer", "folk.hillfolk"]);
    expect(step.dependsOn).toEqual(["calling", "folk"]);
    expect(step.pool).toBeUndefined();
    // As on any step with several choices, the second sees the first one's picks.
    expect(ev.choices["folk-talent"]!.options).not.toContain("talent.climbing");
    expect(ev.choices["folk-talent"]!.step).toBe("talents");
  });

  it("no longer offers a thing given by a fixed grant before the gather step", () => {
    // Without the gather step the talents come right after the calling, before
    // the upbringing that gives haggling for free: haggling would be offered.
    const early = variant({ together: "list", at: 1 });
    const before = evaluateDraft(early, build(early, [["calling", { pick: "calling.lantern-bearer" }]]));
    expect(before.choices["talents-lantern-bearer"]!.options).toContain("talent.haggling");

    const pkg = variant({ together: "list" });
    const ev = evaluateDraft(pkg, build(pkg, LANTERN_HILLFOLK));
    expect(ev.choices["talents-lantern-bearer"]!.options).toEqual([
      "talent.climbing",
      "talent.mending",
      "talent.legends",
    ]);
    const doc = build(pkg, LANTERN_HILLFOLK);
    expect(applyChange(pkg, doc, pool("talents", ["talent.haggling"]))).toEqual({
      ok: false,
      error: { code: "answerDoesNotFit", problem: "notOffered" },
    });
  });
});

describe("one list for the gathered choices", () => {
  it("offers every choice's full list and names what the character already has", () => {
    const pkg = variant({ together: "list" });
    const doc = build(pkg, [...LANTERN_HILLFOLK, pool("talents", ["talent.climbing", "talent.mending"])]);
    const ev = evaluateDraft(pkg, doc);
    const step = ev.steps.find((s) => s.id === "talents")!;
    expect(step.gather).toEqual({ group: "talents", together: "list" });
    // Both choices offer climbing; the picks count for the first, so the
    // second no longer lists them. The list keeps each choice's full offer.
    expect(ev.choices["folk-talent"]!.options).not.toContain("talent.climbing");
    expect(step.pool).toEqual({
      options: [
        "talent.climbing",
        "talent.mending",
        "talent.legends",
        "talent.tracking",
        "talent.listening",
        "talent.sneaking",
      ],
      choices: [
        {
          choice: "talents-lantern-bearer",
          count: 2,
          upTo: false,
          options: ["talent.climbing", "talent.mending", "talent.legends"],
          picks: ["talent.climbing", "talent.mending"],
          remaining: 0,
        },
        {
          choice: "folk-talent",
          count: 1,
          upTo: false,
          options: FOLK_TALENTS,
          picks: [],
          remaining: 1,
        },
      ],
      picks: ["talent.climbing", "talent.mending"],
      count: 3,
      remaining: 1,
      blocked: [],
      held: [
        {
          id: "talent.weather-sense",
          kind: "talent",
          grantedBy: "upbringing.ferry-child",
          step: "upbringing",
          atLevel: 1,
        },
        {
          id: "talent.haggling",
          kind: "talent",
          grantedBy: "upbringing.ferry-child",
          step: "upbringing",
          atLevel: 1,
        },
      ],
      recommended: ["talent.mending", "talent.climbing", "talent.legends"],
    });
    expect(step.status).toBe("open");
  });

  it("assigns picks to the choices that offer them and moves earlier picks when needed", () => {
    const pkg = variant({ together: "list" });
    let doc = build(pkg, [...LANTERN_HILLFOLK, pool("talents", ["talent.tracking"])]);
    // Only the folk talent offers tracking.
    expect(doc.answers["folk-talent"]).toEqual({ picks: ["talent.tracking"] });
    expect(doc.answers["talents-lantern-bearer"]).toBeUndefined();
    // The folk talent is used up: what only it offers cannot be added now.
    let step = evaluateDraft(pkg, doc).steps.find((s) => s.id === "talents")!;
    expect(step.pool!.blocked).toEqual(["talent.listening", "talent.sneaking"]);

    doc = build(pkg, [...LANTERN_HILLFOLK, pool("talents", ["talent.climbing", "talent.mending"])]);
    doc = applyOk(pkg, doc, pool("talents", ["talent.climbing", "talent.mending", "talent.legends"]));
    expect(doc.answers["talents-lantern-bearer"]).toEqual({ picks: ["talent.climbing", "talent.mending"] });
    expect(doc.answers["folk-talent"]).toEqual({ picks: ["talent.legends"] });

    // Tracking needs the folk talent's place: legends moves over to the calling.
    doc = applyOk(pkg, doc, pool("talents", ["talent.climbing", "talent.legends", "talent.tracking"]));
    expect(doc.answers["talents-lantern-bearer"]).toEqual({ picks: ["talent.climbing", "talent.legends"] });
    expect(doc.answers["folk-talent"]).toEqual({ picks: ["talent.tracking"] });
    const ev = evaluateDraft(pkg, doc);
    step = ev.steps.find((s) => s.id === "talents")!;
    expect(step.status).toBe("done");
    expect(step.pool!.remaining).toBe(0);
    for (const t of ["talent.climbing", "talent.legends", "talent.tracking"])
      expect(ev.things.map((h) => h.id)).toContain(t);
  });

  it("keeps a pick with the choice it counts for", () => {
    const pkg = variant({ together: "list" });
    let doc = build(pkg, [...LANTERN_HILLFOLK, ["folk-talent", { picks: ["talent.mending"] }]]);
    doc = applyOk(pkg, doc, pool("talents", ["talent.mending", "talent.climbing"]));
    expect(doc.answers["folk-talent"]).toEqual({ picks: ["talent.mending"] });
    expect(doc.answers["talents-lantern-bearer"]).toEqual({ picks: ["talent.climbing"] });
  });

  it("removes the answers of choices left without picks", () => {
    const pkg = variant({ together: "list" });
    let doc = build(pkg, [...LANTERN_HILLFOLK, pool("talents", ["talent.climbing", "talent.tracking"])]);
    doc = applyOk(pkg, doc, pool("talents", []));
    expect(doc.answers["talents-lantern-bearer"]).toBeUndefined();
    expect(doc.answers["folk-talent"]).toBeUndefined();
  });

  it.each<[string, string[], string]>([
    ["picks no choice has room for", ["talent.tracking", "talent.sneaking"], "notOffered"],
    ["a pick twice", ["talent.climbing", "talent.climbing"], "duplicate"],
    [
      "more picks than places",
      ["talent.climbing", "talent.mending", "talent.legends", "talent.tracking"],
      "tooMany",
    ],
  ])("rejects %s", (_name, picks, problem) => {
    const pkg = variant({ together: "list" });
    const doc = build(pkg, LANTERN_HILLFOLK);
    expect(applyChange(pkg, doc, pool("talents", picks))).toEqual({
      ok: false,
      error: { code: "answerDoesNotFit", problem },
    });
  });

  it("rejects a list change for a step without a list", () => {
    const pkg = variant({ together: "sections" });
    const doc = build(pkg, LANTERN_HILLFOLK);
    expect(applyChange(pkg, doc, pool("talents", []))).toEqual({ ok: false, error: { code: "unknownStep" } });
  });

  it("does not let two choices of the list count the same thing", () => {
    const pkg = variant({ together: "list" });
    const doc = build(pkg, [...LANTERN_HILLFOLK, pool("talents", ["talent.climbing", "talent.mending"])]);
    expect(
      applyChange(pkg, doc, {
        type: "answer",
        choice: "folk-talent",
        answer: { picks: ["talent.climbing"] },
      }),
    ).toEqual({
      ok: false,
      error: { code: "answerDoesNotFit", problem: "notOffered" },
    });
    // A stored double pick (an older draft) is marked, and counts once.
    const ev = evaluateDraft(pkg, {
      ...doc,
      answers: { ...doc.answers, "folk-talent": { picks: ["talent.climbing"] } },
    });
    expect(ev.choices["folk-talent"]).toMatchObject({ status: "invalid", problem: "duplicate" });
    expect(ev.steps.find((s) => s.id === "talents")!.status).toBe("needsAttention");
  });

  // Finding 54: one list asks for 3 talents of the calling and 1 of the folk.
  // Someone answering choice by choice (the API) picks the folk's first; the
  // calling's choice, asked before it, must then neither offer nor recommend
  // that talent, because setting it is refused.
  it("does not offer or recommend what a later choice of the list holds", () => {
    const pkg = variant({ together: "list" });
    const doc = build(pkg, [...LANTERN_HILLFOLK, ["folk-talent", { picks: ["talent.mending"] }]]);
    const ev = evaluateDraft(pkg, doc);
    const calling = ev.choices["talents-lantern-bearer"]!;
    expect(calling.options).toEqual(["talent.climbing", "talent.legends"]);
    // The package recommends mending here; the rest of the list takes its place.
    expect(calling.recommended).toEqual(["talent.climbing", "talent.legends"]);
    // The folk's own pick stays offered to it.
    expect(ev.choices["folk-talent"]!.options).toContain("talent.mending");
    expect(
      applyChange(pkg, doc, {
        type: "answer",
        choice: "talents-lantern-bearer",
        answer: { picks: ["talent.mending", "talent.climbing"] },
      }),
    ).toEqual({ ok: false, error: { code: "answerDoesNotFit", problem: "notOffered" } });
    // What the evaluation recommends, the setter takes, and the step is done.
    const done = applyOk(pkg, doc, {
      type: "answer",
      choice: "talents-lantern-bearer",
      answer: { picks: calling.recommended },
    });
    expect(evaluateDraft(pkg, done).steps.find((s) => s.id === "talents")!.status).toBe("done");
    // The list still lets the picks move: mending can go to the calling.
    const moved = applyOk(
      pkg,
      doc,
      pool("talents", ["talent.mending", "talent.climbing", "talent.tracking"]),
    );
    expect(moved.answers["talents-lantern-bearer"]).toEqual({ picks: ["talent.mending", "talent.climbing"] });
    expect(moved.answers["folk-talent"]).toEqual({ picks: ["talent.tracking"] });
  });

  // Finding 54 for a single pick: when the list takes the package's
  // recommendation away, the first option left is recommended instead.
  it("recommends the first option left to a single pick whose recommendation another choice holds", () => {
    const pkg = variant({ together: "list" });
    const folk = pkg.flow.choices.find((c) => c.id === "folk-talent")!;
    Object.assign(folk, { kind: "pickOne" });
    delete (folk as { count?: unknown }).count;
    const doc = build(pkg, [
      ...LANTERN_HILLFOLK,
      ["talents-lantern-bearer", { picks: ["talent.mending", "talent.climbing"] }],
    ]);
    const ev = evaluateDraft(pkg, doc);
    const single = ev.choices["folk-talent"]!;
    expect(single.options).not.toContain("talent.mending");
    expect(single.recommended).toEqual([single.options![0]]);
    const done = applyOk(pkg, doc, {
      type: "answer",
      choice: "folk-talent",
      answer: { pick: single.options![0] },
    });
    expect(evaluateDraft(pkg, done).steps.find((s) => s.id === "talents")!.status).toBe("done");
  });

  it("recommends a full list without doubles, so choose for me finishes the step", () => {
    const pkg = variant({ together: "list" });
    const doc = build(pkg, LANTERN_HILLFOLK);
    const step = evaluateDraft(pkg, doc).steps.find((s) => s.id === "talents")!;
    // Both choices recommend mending; it is picked once and the list fills up.
    expect(step.pool!.recommended).toEqual(["talent.mending", "talent.climbing", "talent.legends"]);
    const done = applyOk(pkg, doc, pool("talents", step.pool!.recommended));
    expect(evaluateDraft(pkg, done).steps.find((s) => s.id === "talents")!.status).toBe("done");
  });

  it("fills the recommendation from the list when the recommendations cannot all be placed", () => {
    const pkg = variant({ together: "list" });
    const folk = pkg.flow.choices.find((c) => c.id === "folk-talent") as Extract<
      Choice,
      { kind: "pickMany" }
    >;
    folk.recommend = [{ pick: ["talent.legends"] }];
    const talents = pkg.flow.choices.find((c) => c.id === "talents-lantern-bearer") as Extract<
      Choice,
      { kind: "pickMany" }
    >;
    talents.recommend = [{ pick: ["talent.legends", "talent.mending"] }];
    const step = evaluateDraft(pkg, build(pkg, LANTERN_HILLFOLK)).steps.find((s) => s.id === "talents")!;
    expect(step.pool!.recommended).toEqual(["talent.legends", "talent.mending", "talent.climbing"]);
  });
});

function applyOk(pkg: ContentPackage, doc: DraftDocument, change: DraftChange): DraftDocument {
  const r = applyChange(pkg, doc, change);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.doc;
}
