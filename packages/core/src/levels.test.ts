/**
 * Levels 1 to 20 with the demo package: raising scores with a cap, tables
 * by level, repeatable things, the level of each step, and "choose for me"
 * finishing a character at any level.
 */
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyChange,
  evaluateDraft,
  explainValue,
  judgeAnswer,
  levelUp,
  levelUpState,
  newDraft,
  type ChoiceState,
  type DraftChange,
  type DraftDocument,
  type Evaluation,
} from "./index.ts";

let pkg: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
});

function apply(doc: DraftDocument, change: DraftChange): DraftDocument {
  const r = applyChange(pkg, doc, change);
  if (!r.ok) throw new Error(`${JSON.stringify(change)}: ${JSON.stringify(r.error)}`);
  return r.doc;
}

/** What "choose for me" answers for one open choice (as the step screen does), or undefined. */
function recommendation(s: ChoiceState): unknown {
  const def = pkg.flow.choices.find((c) => c.id === (s.copyOf ?? s.id))!;
  const rec = s.recommended;
  if (def.kind === "pickOne" && Array.isArray(rec) && rec[0]) return { pick: rec[0] };
  if (def.kind === "pickMany" && Array.isArray(rec) && rec.length > 0) return { picks: rec };
  if (def.kind === "distribute" && rec && !Array.isArray(rec)) return rec;
  if (def.kind === "number" && def.default !== undefined) return { value: def.default };
  if (def.kind === "text" && def.suggestions) return { text: "Mira Fennwick" };
  return undefined;
}

/**
 * A character built with nothing but "choose for me", step by step; only
 * the calling is picked by hand. Fails if a step has no recommendation.
 */
function chooseForMe(level: number, calling: string): DraftDocument {
  const created = newDraft(pkg, level);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  return answerOpen(apply(created.doc, { type: "answer", choice: "calling", answer: { pick: calling } }));
}

/** Answers every open step with "choose for me", in step order, until the character is complete. */
function answerOpen(doc: DraftDocument, answered: string[] = []): DraftDocument {
  for (let guard = 0; guard < 200; guard++) {
    const ev = evaluateDraft(pkg, doc);
    if (ev.complete) return doc;
    const step = ev.steps.find((s) => s.status !== "done")!;
    if (step.pool) {
      answered.push(...step.pool.choices.filter((c) => c.remaining > 0).map((c) => c.choice));
      doc = apply(doc, { type: "pool", step: step.id, picks: step.pool.recommended });
      continue;
    }
    const open = step.choices.map((c) => ev.choices[c]!).find((c) => c.status !== "answered")!;
    const answer = recommendation(open);
    if (answer === undefined) throw new Error(`no recommendation for ${open.id} at level ${doc.level}`);
    answered.push(open.id);
    doc = apply(doc, { type: "answer", choice: open.id, answer });
  }
  throw new Error(`level ${doc.level} did not complete`);
}

const CALLINGS = ["calling.lantern-bearer", "calling.river-runner", "calling.herbalist"];

describe("choose for me at every level", () => {
  it.each(CALLINGS.flatMap((c) => [1, 5, 11, 20].map((level) => [c, level] as const)))(
    "builds a %s at level %i",
    (calling, level) => {
      const ev = evaluateDraft(pkg, chooseForMe(level, calling));
      expect(ev.complete).toBe(true);
      expect(ev.steps.every((s) => s.atLevel <= level)).toBe(true);
      expect(ev.steps.filter((s) => s.id.startsWith("boon-") && !s.id.includes("@")).length).toBe(
        [4, 8, 12, 16, 19].filter((l) => l <= level).length,
      );
    },
  );

  it("evaluates a level-20 character in well under 50 ms", () => {
    const doc = chooseForMe(20, "calling.herbalist");
    evaluateDraft(pkg, doc); // warm up: parsed expressions are cached
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      evaluateDraft(pkg, doc);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(50);
  });
});

describe("a level-20 lantern bearer, worked out by hand", () => {
  let doc: DraftDocument;
  let ev: Evaluation;
  beforeAll(() => {
    doc = chooseForMe(20, "calling.lantern-bearer");
    ev = evaluateDraft(pkg, doc);
  });

  it("has every value the hand calculation gives", () => {
    // Scores (recommendation): might 8, grace 7, wit 9, heart 11; the ferry child gives grace 1.
    // Boons 4 and 8 raise heart 11 → 13 → 15; then heart is above 13, so 12, 16 and 19 raise wit 9 → 15.
    expect(ev.values).toEqual({
      might: 8,
      grace: 8,
      wit: 15,
      heart: 15,
      mightBonus: 0, // floor(8 / 3) - 2
      graceBonus: 0,
      witBonus: 3, // floor(15 / 3) - 2
      heartBonus: 3,
      stamina: 103, // 0 * 20 + 8 + 5 + 5 + 5 * (20 - 3)
      guard: 9, // 6 + 0 + reed shield 2 + warding glow 1
      pace: 25, // moorfolk
      luck: 3, // min(3, 1 + 3)
      nerve: 14, // 1 + floor(20 / 2) + 3
      carry: 40, // 8 * 5
      practice: 6, // floor(19 / 4) + 2
      sneakRoll: 0, // grace bonus 0, sneaking not trained
      knackRank: 5,
      bloomWardUses: 3, // a herbalist's table; the value is there for everyone
      lanternSlots1: 3,
      lanternSlots2: 2,
      lanternSlots3: 2,
      lanternSlots4: 2,
      lanternSlots5: 2,
      lanternSlots6: 2,
      lanternSlots7: 1,
      lanternSlots8: 1,
      lanternSlots9: 2,
      age: 20,
    });
  });

  it("asks the boons in level order, each raise right after the boon that brought it", () => {
    const ids = ev.steps.map((s) => s.id);
    const from = ids.indexOf("boon-4");
    expect(ids.slice(from, from + 10)).toEqual([
      "boon-4",
      "boon-raise@boon-4",
      "boon-8",
      "boon-raise@boon-8",
      "boon-12",
      "boon-raise@boon-12",
      "boon-16",
      "boon-raise@boon-16",
      "boon-19",
      "boon-raise@boon-19",
    ]);
    expect(ids.indexOf("scores")).toBeLessThan(from);
    expect(ev.steps.length).toBeGreaterThanOrEqual(20);
  });

  it("names the level each step comes from", () => {
    const at = Object.fromEntries(ev.steps.map((s) => [s.id, s.atLevel]));
    expect(at).toMatchObject({
      character: 1,
      calling: 1,
      scores: 1,
      path: 3,
      "lantern-vow": 11,
      "boon-4": 4,
      "boon-raise@boon-4": 4,
      "boon-19": 19,
      "boon-raise@boon-19": 19,
    });
    // The list step holds choices from level 1 and 2: it is there from level 1.
    expect(at["talents"]).toBe(1);
    // Levelling up from 11 to 20 adds exactly these steps.
    expect(ev.steps.filter((s) => s.atLevel > 11).map((s) => s.id)).toEqual([
      "boon-12",
      "boon-raise@boon-12",
      "boon-16",
      "boon-raise@boon-16",
      "boon-19",
      "boon-raise@boon-19",
      "lantern-mastery",
    ]);
    expect(ev.choices["boon-raise@boon-12"]!.atLevel).toBe(12);
    expect(ev.things.find((t) => t.id === "trait.undying-flame")?.atLevel).toBe(17);
    expect(ev.things.find((t) => t.id === "knack.lantern-call")?.atLevel).toBe(3);
  });

  it("keeps a repeatable thing once, and asks its choice once per pick", () => {
    expect(ev.things.filter((t) => t.id === "boon.raise")).toHaveLength(1);
    expect(ev.choices["boon-8"]!.options).toContain("boon.raise");
    expect(ev.choices["boon-raise@boon-8"]).toMatchObject({ copyOf: "boon-raise", kind: "distribute" });
    expect(ev.choices["boon-raise"]).toBeUndefined();
    expect(ev.raises["heart"]).toEqual([
      { amount: 2, choice: "boon-raise@boon-4", atLevel: 4 },
      { amount: 2, choice: "boon-raise@boon-8", atLevel: 8 },
    ]);
  });

  it("explains a raised value by the answers that raised it", () => {
    expect(explainValue(pkg, ev, "heart")?.parts).toEqual([
      { amount: 11, source: { kind: "choice", choice: "scores" } },
      { amount: 2, source: { kind: "choice", choice: "boon-raise@boon-4" } },
      { amount: 2, source: { kind: "choice", choice: "boon-raise@boon-8" } },
    ]);
    // A table given by the calling is the calling's; a value's own table is the level's.
    expect(explainValue(pkg, ev, "lanternSlots9")?.parts).toEqual([
      { amount: 2, source: { kind: "thing", thing: "calling.lantern-bearer" } },
    ]);
    expect(explainValue(pkg, ev, "knackRank")?.parts).toEqual([
      { amount: 5, source: { kind: "values", values: ["level"] } },
    ]);
  });

  it("keeps the answers of higher levels when the level goes down, and uses them again when it goes up", () => {
    const low = apply(doc, { type: "setLevel", level: 5 });
    const ev5 = evaluateDraft(pkg, low);
    // Level 5 asks 4 lantern knacks of rank 2 at most; the 8 picked at level 20 include
    // higher ranks. Nothing else is open.
    expect(ev5.open).toEqual(["knacks-lantern"]);
    expect(ev5.choices["knacks-lantern"]).toMatchObject({
      count: 4,
      status: "invalid",
      problem: "notOffered",
    });
    expect(ev5.inactiveAnswers).toEqual(
      expect.arrayContaining(["boon-8", "boon-raise@boon-8", "boon-19", "boon-raise@boon-19", "lantern-vow"]),
    );
    expect(ev5.inactiveAnswers).not.toContain("boon-4");
    expect(ev5.values["heart"]).toBe(13);
    expect(ev5.values["wit"]).toBe(9);

    const back = evaluateDraft(pkg, apply(low, { type: "setLevel", level: 20 }));
    expect(back.complete).toBe(true);
    expect(back.values).toEqual(ev.values);
    expect(back.inactiveAnswers).toEqual([]);
  });

  it("keeps a later copy's answer when an earlier pick of the repeatable thing changes", () => {
    const changed = apply(doc, { type: "answer", choice: "boon-4", answer: { pick: "boon.sure-step" } });
    const ev2 = evaluateDraft(pkg, changed);
    expect(ev2.inactiveAnswers).toContain("boon-raise@boon-4");
    expect(ev2.choices["boon-raise@boon-8"]!.status).toBe("answered");
    // Sure step: pace 5 more, stamina 1 more per level.
    expect(ev2.values["pace"]).toBe(30);
    expect(ev2.values["stamina"]).toBe(123);
  });
});

describe("raising values", () => {
  let doc: DraftDocument;
  beforeAll(() => {
    doc = chooseForMe(8, "calling.lantern-bearer");
  });
  const raise = (d: DraftDocument, choice: string, assign: Record<string, number>) =>
    applyChange(pkg, d, { type: "answer", choice, answer: { method: 0, assign } });

  it("adds points on top of the value, up to the cap", () => {
    const ev = evaluateDraft(pkg, doc);
    const state = ev.choices["boon-raise@boon-8"]!;
    // Heart 13 before boon 8 (11 + 2 from boon 4): it can still take 2.
    expect(state.raise).toEqual({
      points: 2,
      before: { might: 8, grace: 8, wit: 9, heart: 13 },
      most: { might: 2, grace: 2, wit: 2, heart: 2 },
    });
    const r = raise(doc, "boon-raise@boon-8", { might: 1, grace: 1 });
    expect(r.ok).toBe(true);
    const after = evaluateDraft(pkg, r.ok ? r.doc : doc);
    expect([after.values["might"], after.values["grace"], after.values["heart"]]).toEqual([9, 9, 13]);
  });

  it("refuses more than the points, more than one target may take, and values that are not targets", () => {
    const problem = (assign: Record<string, number>) => {
      const r = raise(doc, "boon-raise@boon-8", assign);
      return r.ok ? "ok" : r.error;
    };
    expect(problem({ might: 2, grace: 1 })).toEqual({ code: "answerDoesNotFit", problem: "overBudget" });
    expect(problem({ might: 3 })).toEqual({ code: "answerDoesNotFit", problem: "outOfRange" });
    expect(problem({ luck: 1, might: 1 })).toEqual({ code: "answerDoesNotFit", problem: "badAssignment" });
    expect(problem({ might: -1, grace: 2 })).toEqual({ code: "answerDoesNotFit", problem: "badAssignment" });
  });

  it("refuses to go over the cap, and is complete with fewer points only when no target can take more", () => {
    // Keen senses: 1 point on wit or heart, cap 10 + practice (4 at level 8): 14.
    const keen = (assign: Record<string, number>) =>
      judgeAnswer(
        pkg.flow.choices.find((c) => c.id === "keen-senses-raise")!,
        { method: 0, assign },
        { raise: { points: 1, most: { wit: 0, heart: 1 } } },
      );
    expect(keen({ wit: 1 })).toMatchObject({ status: "invalid", problem: "outOfRange" });
    expect(keen({})).toMatchObject({ status: "incomplete", remaining: 1 });
    expect(keen({ heart: 1 })).toEqual({ status: "answered", raises: { heart: 1 } });
    const full = judgeAnswer(
      pkg.flow.choices.find((c) => c.id === "keen-senses-raise")!,
      { method: 0, assign: {} },
      { raise: { points: 1, most: { wit: 0, heart: 0 } } },
    );
    expect(full).toEqual({ status: "answered", raises: {} });
  });

  it("recommends the package's assignment as far as it fits, the rest in order", () => {
    // Boon 8 with heart already at 15: the package says wit 2.
    const at15 = apply(doc, {
      type: "answer",
      choice: "boon-raise@boon-4",
      answer: { method: 0, assign: { heart: 2 } },
    });
    const ev = evaluateDraft(pkg, at15);
    expect(ev.choices["boon-raise@boon-8"]!.recommended).toEqual({ method: 0, assign: { heart: 2 } });
    const high = {
      ...at15,
      answers: { ...at15.answers, scores: { method: 0, assign: { might: 8, grace: 7, wit: 9, heart: 12 } } },
    };
    // Heart 12 + 2 = 14: still at most 13 is false, so the package says wit; heart could take only 1.
    const ev2 = evaluateDraft(pkg, high);
    expect(ev2.values["heart"]).toBe(14);
    expect(ev2.choices["boon-raise@boon-8"]!.recommended).toEqual({ method: 0, assign: { wit: 2 } });
  });
});

describe("tables by level", () => {
  it("takes a value's base, a grant's amount and a pick count from the row of the level", () => {
    const at = (level: number) => evaluateDraft(pkg, chooseForMe(level, "calling.lantern-bearer"));
    const l1 = at(1);
    const l9 = at(9);
    expect([l1.values["knackRank"], l9.values["knackRank"]]).toEqual([1, 3]);
    expect([l1.values["lanternSlots1"], l9.values["lanternSlots5"]]).toEqual([1, 1]);
    expect([l1.choices["knacks-lantern"]!.count, l9.choices["knacks-lantern"]!.count]).toEqual([2, 5]);
    // knackRank 3 at level 9 offers the rank-3 knack, not yet the rank-4 one.
    expect(l9.choices["knacks-lantern"]!.options).toContain("knack.dawn-flare");
    expect(l9.choices["knacks-lantern"]!.options).not.toContain("knack.star-lantern");
    // Without the calling that gives them, the slots stay 0.
    const runner = evaluateDraft(pkg, chooseForMe(20, "calling.river-runner"));
    expect(runner.values["lanternSlots9"]).toBe(0);
  });

  it("puts the practice bonus into the values that use it", () => {
    const practice = [1, 4, 5, 8, 9, 13, 17, 20].map(
      (level) => evaluateDraft(pkg, { level, answers: {} }).values["practice"],
    );
    expect(practice).toEqual([2, 2, 3, 3, 4, 5, 6, 6]);
    // The river runner trains sneaking: grace bonus + practice.
    const ev = evaluateDraft(pkg, chooseForMe(20, "calling.river-runner"));
    expect(ev.things.some((t) => t.id === "talent.sneaking")).toBe(true);
    expect(ev.values["sneakRoll"]).toBe(ev.values["graceBonus"]! + 6);
    expect(explainValue(pkg, ev, "sneakRoll")?.parts).toContainEqual({
      amount: 6,
      source: { kind: "values", values: ["practice"] },
    });
  });
});

describe("raising a finished character", () => {
  /**
   * Raises `doc` to `level` and checks that nothing chosen is lost: every
   * answer stays, every choice answered before is still answered, or asks
   * for more picks on top of the ones it keeps.
   */
  function raise(doc: DraftDocument, level: number) {
    const before = evaluateDraft(pkg, doc);
    const r = levelUp(pkg, doc, level);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.doc).toEqual({ level, levelBefore: doc.level, answers: doc.answers });
    const ev = evaluateDraft(pkg, r.doc);
    const grown: string[] = [];
    for (const [id, was] of Object.entries(before.choices)) {
      if (was.status !== "answered") continue;
      const now = ev.choices[id]!;
      if (now.status === "answered") continue;
      expect(now, id).toMatchObject({ status: "incomplete", answer: was.answer });
      expect(now.count!, id).toBeGreaterThan(was.count!);
      grown.push(id);
    }
    const state = levelUpState(ev, doc.level);
    const answered: string[] = [];
    // Finishing (the API's part) ends the raise.
    const { levelBefore: _, ...after } = answerOpen(r.doc, answered);
    const done = evaluateDraft(pkg, after);
    // Only what the raise added or grew is asked; a copy of a choice comes with the pick that brings it.
    const added = levelUpState(done, doc.level).newChoices;
    for (const id of answered) expect([...added, ...grown], id).toContain(id);
    for (const id of state.newChoices.filter((c) => ev.choices[c]!.status !== "answered")) {
      expect(answered).toContain(id);
    }
    return { state, grown, answered, doc: after, ev: done };
  }

  it("raises a level-1 character to 2, 3 and 5, asking only what the new levels add", () => {
    const l1 = chooseForMe(1, "calling.lantern-bearer");

    // 1 → 2: no new step, but the talent group gets a level-2 choice and the
    // knack count grows from 2 to 3 (table by level). Both steps were there before.
    const to2 = raise(l1, 2);
    expect(to2.state).toEqual({
      from: 1,
      to: 2,
      newSteps: [],
      newChoices: ["extra-talent"],
      openSteps: ["talents", "knacks"],
    });
    expect(to2.grown).toEqual(["knacks-lantern"]);
    expect(to2.answered).toEqual(["extra-talent", "knacks-lantern"]);
    expect(to2.ev.complete).toBe(true);
    expect(to2.ev.values).toMatchObject({
      stamina: 13, // 0 * 2 + 8 + 5
      practice: 2,
      nerve: 3, // 1 + floor(2 / 2) + heart bonus 1
      knackRank: 1,
      lanternSlots1: 2,
      lanternSlots2: 0,
      guard: 8, // 6 + 0 + reed shield 2
    });

    // 2 → 3: the path is the only new step; nothing older grows.
    const to3 = raise(to2.doc, 3);
    expect(to3.state).toMatchObject({ from: 2, to: 3, newSteps: ["path"], openSteps: ["path"] });
    expect(to3.grown).toEqual([]);
    expect(to3.answered).toEqual(["path"]);
    expect(to3.ev.values).toMatchObject({
      stamina: 18, // 8 + 5 + 5
      practice: 2,
      nerve: 3,
      lanternSlots1: 2,
      lanternSlots2: 1,
      guard: 9, // the path's warding glow: 1 more
    });

    // 3 → 5: boon 4 (and the raise it brings), and two more knacks of rank 2 at most.
    const to5 = raise(to3.doc, 5);
    expect(to5.state).toMatchObject({
      from: 3,
      to: 5,
      newSteps: ["boon-4"],
      openSteps: ["boon-4", "knacks"],
    });
    expect(to5.grown).toEqual(["knacks-lantern"]);
    expect(to5.answered).toEqual(["boon-4", "boon-raise@boon-4", "knacks-lantern"]);
    expect(to5.ev.values).toMatchObject({
      heart: 13, // 11 + 2 from boon 4
      heartBonus: 2, // floor(13 / 3) - 2
      stamina: 28, // 8 + 5 + 5 + 5 * (5 - 3)
      practice: 3,
      nerve: 5, // 1 + floor(5 / 2) + 2
      luck: 3, // min(3, 1 + 2)
      knackRank: 2,
      lanternSlots1: 3,
      lanternSlots2: 2,
      lanternSlots3: 1,
    });
    // Every answer of levels 1 and 3 is still there, unchanged unless it grew.
    for (const [id, a] of Object.entries(to3.doc.answers)) {
      if (id !== "knacks-lantern") expect(to5.doc.answers[id], id).toEqual(a);
    }
  });

  it("raises a level-1 character to 20 in one go: the same character as one built at 20", () => {
    const l1 = chooseForMe(1, "calling.lantern-bearer");
    const to20 = raise(l1, 20);
    expect(to20.state.newSteps).toEqual([
      "path",
      "lantern-vow",
      "boon-4",
      "boon-8",
      "boon-12",
      "boon-16",
      "boon-19",
    ]);
    expect(to20.state.openSteps).toEqual([...to20.state.newSteps, "talents", "knacks"]);
    expect(to20.ev.complete).toBe(true);
    // The level-20 lantern bearer worked out by hand above.
    expect(to20.ev.values).toEqual(evaluateDraft(pkg, chooseForMe(20, "calling.lantern-bearer")).values);
    expect(to20.ev.values).toMatchObject({
      stamina: 103,
      practice: 6,
      nerve: 14,
      wit: 15,
      heart: 15,
      knackRank: 5,
    });
    expect(to20.ev.choices["lantern-vow"]!.textVariant).toBe("late");
  });

  it("switches a text variant by level on a raise, without asking the choice again", () => {
    const l11 = raise(chooseForMe(1, "calling.lantern-bearer"), 11);
    expect(l11.answered).toContain("lantern-vow");
    expect(l11.ev.choices["lantern-vow"]!.textVariant).toBeUndefined();
    const l17 = raise(l11.doc, 17);
    expect(l17.answered).not.toContain("lantern-vow");
    expect(l17.ev.choices["lantern-vow"]).toMatchObject({ status: "answered", textVariant: "late" });
  });

  it("finishes at once when the new level asks nothing", () => {
    // 4 → 5 brings no step and no larger count for a lantern bearer.
    const l4 = chooseForMe(4, "calling.lantern-bearer");
    const r = levelUp(pkg, l4, 5);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const ev = evaluateDraft(pkg, r.doc);
    expect(ev.complete).toBe(true);
    expect(levelUpState(ev, 4)).toEqual({ from: 4, to: 5, newSteps: [], newChoices: [], openSteps: [] });
    expect(ev.values["practice"]).toBe(3);
  });

  it("refuses a level that is not higher or above the package's highest, and keeps the first start level", () => {
    const l3 = chooseForMe(3, "calling.lantern-bearer");
    expect(levelUp(pkg, l3, 3)).toEqual({ ok: false, error: { code: "levelNotHigher", level: 3 } });
    expect(levelUp(pkg, l3, 2)).toEqual({ ok: false, error: { code: "levelNotHigher", level: 3 } });
    expect(levelUp(pkg, l3, 21)).toEqual({ ok: false, error: { code: "levelOutOfRange", min: 1, max: 20 } });
    const to5 = levelUp(pkg, l3, 5);
    if (!to5.ok) throw new Error();
    const to8 = levelUp(pkg, to5.doc, 8);
    expect(to8.ok && to8.doc).toMatchObject({ level: 8, levelBefore: 3 });
    // Setting the level back to the start ends the raise.
    expect(apply(to5.doc, { type: "setLevel", level: 3 })).toEqual({ level: 3, answers: l3.answers });
    expect(apply(to5.doc, { type: "setLevel", level: 4 })).toMatchObject({ level: 4, levelBefore: 3 });
  });
});

describe("a raise sees the character at its own level", () => {
  // The river runner gets grace +2 from the tide crown at level 20 only.
  let doc: DraftDocument;
  let ev: Evaluation;
  beforeAll(() => {
    doc = chooseForMe(20, "calling.river-runner");
    ev = evaluateDraft(pkg, doc);
  });

  it("does not count a bonus of a higher level against the cap of an earlier raise", () => {
    expect(ev.things.find((t) => t.id === "trait.tide-crown")?.atLevel).toBe(20);
    const at19 = evaluateDraft(pkg, apply(doc, { type: "setLevel", level: 19 }));
    // Every raise looks the same at level 19 and 20: the crown is not there yet when they are made.
    for (const id of ["boon-raise@boon-4", "boon-raise@boon-8", "boon-raise@boon-19"]) {
      expect(ev.choices[id]!.raise).toEqual(at19.choices[id]!.raise);
      expect(ev.choices[id]!.recommended).toEqual(at19.choices[id]!.recommended);
    }
    expect(ev.values["grace"]).toBe(at19.values["grace"]! + 2);
  });

  it("takes grace up to the cap before the crown, and the crown goes above it", () => {
    // Grace 13 before boon 4 would leave room for 2 at cap 15. With the crown
    // counted at level 4 (grace 15) there would be no room at all.
    const raised = apply(doc, {
      type: "answer",
      choice: "boon-raise@boon-4",
      answer: { method: 0, assign: { grace: 2 } },
    });
    const ev2 = evaluateDraft(pkg, raised);
    const before = ev2.choices["boon-raise@boon-4"]!.raise!.before["grace"]!;
    expect(ev2.choices["boon-raise@boon-4"]!.raise!.most["grace"]).toBe(Math.min(2, 15 - before));
    expect(ev2.raises["grace"]?.[0]).toMatchObject({ choice: "boon-raise@boon-4", atLevel: 4 });
    // Value max 17: the crown's 2 come on top of whatever the boons gave.
    const fromBoons = (ev2.raises["grace"] ?? []).reduce((n, r) => n + r.amount, 0);
    expect(ev2.values["grace"]).toBe(Math.min(17, before + fromBoons + 2));
  });
});

describe("picking among what the character has", () => {
  let doc: DraftDocument;
  let ev: Evaluation;
  beforeAll(() => {
    doc = chooseForMe(18, "calling.lantern-bearer");
    ev = evaluateDraft(pkg, doc);
  });
  const knacksHeld = () => ev.things.filter((h) => h.kind === "knack").map((h) => h.id);

  it("offers exactly the knacks the character has, from level 18 on", () => {
    const state = ev.choices["lantern-mastery"]!;
    expect(state.atLevel).toBe(18);
    expect([...state.options!].sort()).toEqual(knacksHeld().sort());
    expect(state.options).toContain("knack.lantern-call"); // from the path, not picked
    // It depends on the step that gave the knacks.
    expect(ev.steps.find((s) => s.id === "lantern-mastery")!.dependsOn).toContain("knacks");
    expect(evaluateDraft(pkg, apply(doc, { type: "setLevel", level: 17 })).choices["lantern-mastery"]).toBe(
      undefined,
    );
  });

  it("marks the picks without giving anything a second time", () => {
    const picks = ev.choices["lantern-mastery"]!.answer as { picks: string[] };
    expect(ev.choices["lantern-mastery"]!.status).toBe("answered");
    expect(Object.keys(ev.marks).sort()).toEqual([...picks.picks].sort());
    for (const p of picks.picks) {
      expect(ev.marks[p]).toEqual(["lantern-mastery"]);
      const held = ev.things.filter((h) => h.id === p);
      expect(held).toHaveLength(1);
      expect(held[0]!.pickedIn).not.toBe("lantern-mastery");
    }
  });

  it("refuses a thing the character does not have, and asks again when a picked one is gone", () => {
    const notHeld = pkg.things.find((t) => t.kind === "knack" && !ev.things.some((h) => h.id === t.id))!.id;
    const r = applyChange(pkg, doc, {
      type: "answer",
      choice: "lantern-mastery",
      answer: { picks: [notHeld, ev.choices["lantern-mastery"]!.options![0]!] },
    });
    expect(r.ok ? "ok" : r.error).toEqual({ code: "answerDoesNotFit", problem: "notOffered" });

    // Swap a picked knack for one the character did not have: the mark no longer fits.
    const picked = (ev.choices["lantern-mastery"]!.answer as { picks: string[] }).picks[0]!;
    const knacks = (ev.choices["knacks-lantern"]!.answer as { picks: string[] }).picks;
    const other = ev.choices["knacks-lantern"]!.options!.find((o) => !knacks.includes(o))!;
    expect(knacks).toContain(picked);
    const swapped = {
      ...doc,
      answers: { ...doc.answers, "knacks-lantern": { picks: knacks.map((k) => (k === picked ? other : k)) } },
    };
    const ev2 = evaluateDraft(pkg, swapped);
    expect(ev2.choices["lantern-mastery"]).toMatchObject({ status: "invalid", problem: "notOffered" });
    expect(ev2.marks[picked]).toBeUndefined();
    expect(ev2.open).toContain("lantern-mastery");
  });
});
