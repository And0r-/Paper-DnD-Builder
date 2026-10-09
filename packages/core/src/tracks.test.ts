/**
 * Tracks (SPEC 9.7) on the demo package: the callings carry the levels.
 * Invented rules only: what a calling needs to be added, gifts only for the
 * first or an added calling, glow slots shared by a level that adds up two
 * callings, and a rank limit per calling on the knack choices.
 */
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir, type ContentPackage } from "@builder/format";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyChange,
  evaluateDraft,
  explainValue,
  headTracks,
  levelUp,
  newDraft,
  summarize,
  tracksText,
  type ChoiceState,
  type DraftChange,
  type DraftDocument,
} from "./index.ts";

const L = "calling.lantern-bearer";
const R = "calling.river-runner";
const H = "calling.herbalist";

let pkg: ContentPackage;
/** The demo package without tracks: one calling carries every level. */
let plain: ContentPackage;
beforeAll(async () => {
  const r = await validatePackageDir(DEMO_PACKAGE_DIR);
  if (!r.package) throw new Error("demo package is invalid");
  pkg = r.package;
  plain = structuredClone(pkg);
  delete plain.flow.level.tracks;
});

/** Scores that meet what the lantern bearer and the herbalist need to be added (heart 10, wit 10), not the river runner. */
const LANTERN_AND_HERBS = { method: 0, assign: { mightBase: 8, graceBase: 6, witBase: 10, heartBase: 12 } };

function apply(doc: DraftDocument, change: DraftChange, p = pkg): DraftDocument {
  const r = applyChange(p, doc, change);
  if (!r.ok) throw new Error(`${JSON.stringify(change)}: ${JSON.stringify(r.error)}`);
  return r.doc;
}

/** What "choose for me" answers for one open choice, or undefined. */
function recommendation(p: ContentPackage, s: ChoiceState): unknown {
  const def = p.flow.choices.find((c) => c.id === (s.copyOf ?? s.id))!;
  // The demo recommends for one calling at a time; a copy of an added one takes the first options.
  const rec =
    Array.isArray(s.recommended) && s.recommended.length === 0
      ? s.options?.slice(0, s.count ?? 1)
      : s.recommended;
  if (def.kind === "pickOne" && Array.isArray(rec) && rec[0]) return { pick: rec[0] };
  if (def.kind === "pickMany" && Array.isArray(rec) && rec.length > 0) return { picks: rec };
  if (def.kind === "distribute" && rec && !Array.isArray(rec)) return rec;
  if (def.kind === "number" && def.default !== undefined) return { value: def.default };
  if (def.kind === "text" && def.suggestions) return { text: "Mira Fennwick" };
  return undefined;
}

/** Answers every open step with "choose for me" until the character is complete (or nothing is open). */
function answerOpen(doc: DraftDocument, p = pkg): DraftDocument {
  for (let guard = 0; guard < 300; guard++) {
    const ev = evaluateDraft(p, doc);
    const step = ev.steps.find((s) => s.status !== "done");
    if (!step) return doc;
    if (step.pool) {
      doc = apply(doc, { type: "pool", step: step.id, picks: step.pool.recommended }, p);
      continue;
    }
    const open = step.choices.map((c) => ev.choices[c]!).find((c) => c.status !== "answered")!;
    const answer = recommendation(p, open);
    if (answer === undefined) throw new Error(`no recommendation for ${open.id}`);
    doc = apply(doc, { type: "answer", choice: open.id, answer }, p);
  }
  throw new Error("did not complete");
}

/**
 * A character of `first` with these tracks for levels 2 on, the scores
 * given (else those recommended), every other answer "choose for me".
 */
function build(
  first: string,
  tracks: string[],
  {
    level = tracks.length + 1,
    scores,
    p = pkg,
  }: { level?: number; scores?: unknown; p?: ContentPackage } = {},
): DraftDocument {
  const created = newDraft(p, level);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  let doc = apply(created.doc, { type: "answer", choice: "calling", answer: { pick: first } }, p);
  if (scores) doc = apply(doc, { type: "answer", choice: "scores", answer: scores }, p);
  if (tracks.length > 0) doc = apply(doc, { type: "tracks", tracks }, p);
  return answerOpen(doc, p);
}

describe("one track", () => {
  it("computes a draft without tracks exactly as one with every level in the first track", () => {
    for (const calling of [L, R, H])
      for (const level of [1, 4, 8, 13, 20]) {
        const doc = build(calling, [], { level });
        expect(doc.tracks).toBeUndefined();
        const ev = evaluateDraft(pkg, doc);
        expect(ev.complete).toBe(true);
        expect(evaluateDraft(pkg, { ...doc, tracks: Array(level - 1).fill(calling) })).toEqual(ev);
        expect(ev.tracks).toMatchObject({ first: calling, unfit: [] });
        expect(ev.tracks!.list).toEqual([{ thing: calling, levels: level, from: 1, added: false }]);
        // A single calling's level is the character level.
        expect(ev.choices[`boon-4`]?.atLevel).toBe(level >= 4 ? 4 : undefined);
      }
  });

  it("keeps a draft without tracks when every level goes to the first track", () => {
    const doc = build(L, [L, L, L]);
    expect(doc.tracks).toBeUndefined();
    const raised = levelUp(pkg, doc, 6);
    expect(raised.ok && raised.doc.tracks).toBeUndefined();
  });
});

describe("two tracks", () => {
  it("counts each calling's grants by the levels in it", () => {
    // Lantern bearer 3 / herbalist 2.
    const doc = build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS });
    const ev = evaluateDraft(pkg, doc);
    expect(ev.complete).toBe(true);
    expect(ev.tracks).toMatchObject({
      first: L,
      levels: [L, L, L, H, H],
      list: [
        { thing: L, levels: 3, from: 1, added: false },
        { thing: H, levels: 2, from: 4, added: true },
      ],
      unfit: [],
    });
    const held = (id: string) => ev.things.find((t) => t.id === id);
    expect(held(H)).toMatchObject({ pickedIn: "calling", atLevel: 4, track: H });
    // Herbalist level 2 comes at character level 5; its level-3 gifts not yet.
    expect(held("trait.green-thumb")).toMatchObject({ atLevel: 5, track: H });
    expect(held("trait.steady-flame")).toMatchObject({ atLevel: 2, track: L });
    expect(held("trait.bright-beacon")).toBeUndefined();
    // Only the first calling's gear.
    expect(held("item.lantern-staff")).toMatchObject({ track: L });
    expect(held("item.herb-satchel")).toBeUndefined();
    // Stamina: 8 + 5 + 5 for the lantern bearer, 4 (added) + 4 for the herbalist, and the might bonus per level.
    const mightBonus = ev.values["mightBonus"]!;
    expect(ev.values["stamina"]).toBe(8 + 5 + 5 + 4 + 4 + mightBonus * 5);
  });

  it("asks the added calling's choices as copies, at the character level its levels came", () => {
    const ev = evaluateDraft(pkg, build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS }));
    expect(ev.choices["added-talent-herbalist@calling.herbalist"]).toMatchObject({
      copyOf: "added-talent-herbalist",
      atLevel: 4,
      track: H,
      status: "answered",
    });
    expect(ev.choices["borrowed-knack@calling.herbalist"]).toMatchObject({ atLevel: 5, track: H });
    // The first calling keeps the plain ids; what only the first gets is not asked again.
    expect(ev.choices["talents-lantern-bearer"]).toMatchObject({ atLevel: 1, track: L });
    expect(ev.choices["talents-lantern-bearer"]!.copyOf).toBeUndefined();
    expect(ev.choices["talents-herbalist@calling.herbalist"]).toBeUndefined();
    expect(ev.choices["added-talent-lantern-bearer"]).toBeUndefined();
    const step = ev.steps.find((s) => s.id === "herb-craft@calling.herbalist");
    expect(step).toMatchObject({ atLevel: 4, track: H, trackLevel: 1 });
  });

  it("gives no boon at 3 / 2 and two at 4 / 4 (concept 9.3)", () => {
    const boons = (doc: DraftDocument) =>
      Object.keys(evaluateDraft(pkg, doc).choices).filter((c) => /^boon-\d+(@|$)/.test(c));
    expect(boons(build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS }))).toEqual([]);
    const doc = build(L, [L, L, L, H, H, H, H], { scores: LANTERN_AND_HERBS });
    const ev = evaluateDraft(pkg, doc);
    expect(ev.complete).toBe(true);
    expect(boons(doc)).toEqual(["boon-4", "boon-4@calling.herbalist"]);
    expect(ev.choices["boon-4"]).toMatchObject({ atLevel: 4, track: L });
    expect(ev.choices["boon-4@calling.herbalist"]).toMatchObject({ atLevel: 8, track: H });
    // The raise each boon brings is asked once per boon.
    expect(ev.choices["boon-raise@boon-4"]).toBeDefined();
    expect(ev.choices["boon-raise@boon-4@calling.herbalist"]).toMatchObject({ atLevel: 8 });
  });

  it("counts a table by level in a choice's count by the levels in its calling", () => {
    // Lantern bearer 1 / herbalist 4: the lantern knacks are those of level 1.
    const ev = evaluateDraft(pkg, build(L, [H, H, H, H], { scores: LANTERN_AND_HERBS }));
    expect(ev.choices["knacks-lantern"]).toMatchObject({ count: 2 });
    expect(ev.choices["knacks-root@calling.herbalist"]).toMatchObject({ count: 4 });
  });

  it("limits a choice to the rank its own calling reaches (concept 9.4)", () => {
    // Lantern bearer 1 / herbalist 10: shared glow slots of rank 3, but the lantern bearer's own rank is 1.
    const doc = build(L, Array(10).fill(H), { scores: LANTERN_AND_HERBS });
    const ev = evaluateDraft(pkg, doc);
    expect(ev.values["glowLevel"]).toBe(6);
    expect(ev.values["lanternSlots3"]).toBeGreaterThan(0);
    expect(ev.values["lanternKnackRank"]).toBe(1);
    expect(ev.values["rootKnackRank"]).toBe(3);
    expect(ev.choices["knacks-lantern"]!.options).not.toContain("knack.light-bridge");
    expect(ev.choices["knacks-lantern"]!.options).not.toContain("knack.dawn-flare");
    expect(ev.choices["knacks-root@calling.herbalist"]!.options).toContain("knack.bramble-wall");
    // A stored pick above the rank no longer fits.
    const wrong = {
      ...doc,
      answers: { ...doc.answers, "knacks-lantern": { picks: ["knack.light-bridge", "knack.warm-glow"] } },
    };
    expect(evaluateDraft(pkg, wrong).choices["knacks-lantern"]).toMatchObject({
      status: "invalid",
      problem: "notOffered",
    });
  });

  it("knows levelOf() and the table by value", () => {
    const ev = evaluateDraft(pkg, build(R, [R, R, H, L]));
    // 1 lantern bearer level + half of 1 herbalist level, rounded up.
    expect(ev.values["glowLevel"]).toBe(2);
    expect(ev.values["lanternKnackRank"]).toBe(1);
    expect(ev.values["rootKnackRank"]).toBe(1);
    expect(ev.values["currentSlotRank"]).toBe(2);
  });

  it("asks levelOf() at the level of a step made once, not of the finished character", () => {
    const p = structuredClone(pkg);
    const cloak = p.things.find((t) => t.id === "item.travel-cloak")!;
    cloak.requires = `levelOf('${L}') >= 2`;
    // The gear is picked at level 1: the cloak needs 2 lantern bearer levels, even if the character is built at 3.
    expect(evaluateDraft(p, build(L, [], { level: 3, p })).choices["gear"]!.options).not.toContain(cloak.id);
    expect(evaluateDraft(pkg, build(L, [], { level: 3 })).choices["gear"]!.options).toContain(cloak.id);
  });

  it("names the calling in the explanation of a value", () => {
    const ev = evaluateDraft(pkg, build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS }));
    const parts = explainValue(pkg, ev, "stamina")!.parts;
    expect(parts).toContainEqual({
      amount: 18,
      source: { kind: "thing", thing: L, track: L, trackLevel: 3 },
    });
    expect(parts).toContainEqual({ amount: 8, source: { kind: "thing", thing: H, track: H, trackLevel: 2 } });
  });

  it("writes the head line with the most levels first", () => {
    const ev = evaluateDraft(pkg, build(H, [L, L, L, H]));
    expect(headTracks(ev)).toEqual([
      { thing: L, levels: 3 },
      { thing: H, levels: 2 },
    ]);
    expect(tracksText(headTracks(ev), (id) => id.slice(8))).toBe("lantern-bearer 3 / herbalist 2");
    const tie = evaluateDraft(pkg, build(H, [L]));
    expect(tracksText(headTracks(tie), (id) => id.slice(8))).toBe("herbalist 1 / lantern-bearer 1");
  });
});

describe("adding a track", () => {
  it("offers every calling for the next level, with what is not met", () => {
    const ev = evaluateDraft(pkg, build(L, [L, L], { scores: LANTERN_AND_HERBS }));
    expect(ev.tracks!.options).toEqual([
      { thing: L, allowed: true },
      { thing: R, allowed: false, notMet: [R] },
      { thing: H, allowed: true },
    ]);
  });

  it("raises into a new calling, or refuses with the reason", () => {
    const doc = build(L, [L, L], { scores: LANTERN_AND_HERBS });
    const raised = levelUp(pkg, doc, 4, [H]);
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    expect(raised.doc).toMatchObject({ level: 4, levelBefore: 3, tracks: [L, L, H] });
    const ev = evaluateDraft(pkg, raised.doc);
    expect(ev.steps.filter((s) => s.atLevel > 3).every((s) => s.track === H)).toBe(true);
    expect(levelUp(pkg, doc, 4, [R])).toEqual({
      ok: false,
      error: { code: "trackNotAllowed", thing: R, level: 4, notMet: [R] },
    });
    // Without tracks named, the levels go where the last one went.
    const more = levelUp(pkg, answerOpen(raised.doc), 6);
    expect(more.ok && more.doc.tracks).toEqual([L, L, H, H, H]);
    expect(levelUp(pkg, doc, 4, ["knack.eddy"])).toEqual({
      ok: false,
      error: { code: "unknownTrack", thing: "knack.eddy" },
    });
    expect(levelUp(pkg, doc, 4, [H, H])).toEqual({ ok: false, error: { code: "tooManyTracks", most: 1 } });
    expect(levelUp(plain, doc, 4, [H])).toEqual({ ok: false, error: { code: "noTracks" } });
  });

  it("checks the tracks the character has, too, with addRequiresCurrent", () => {
    // A herbalist with heart 12 may add the lantern bearer while its own wit is 10 or more.
    let doc = build(H, [H], { scores: LANTERN_AND_HERBS });
    expect(levelUp(pkg, doc, 3, [L]).ok).toBe(true);
    doc = apply(doc, {
      type: "answer",
      choice: "scores",
      answer: { method: 0, assign: { mightBase: 8, graceBase: 8, witBase: 6, heartBase: 12 } },
    });
    // Wit 6: the herbalist itself no longer meets its own condition.
    expect(levelUp(pkg, doc, 3, [L])).toEqual({
      ok: false,
      error: { code: "trackNotAllowed", thing: L, level: 3, notMet: [H] },
    });
    const off = structuredClone(pkg);
    off.flow.level.tracks = { choice: "calling" };
    expect(levelUp(off, doc, 3, [L]).ok).toBe(true);
  });

  it("marks an added track whose condition no longer holds; it still counts", () => {
    let doc = build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS });
    doc = apply(doc, {
      type: "answer",
      choice: "scores",
      answer: { method: 0, assign: { mightBase: 8, graceBase: 8, witBase: 6, heartBase: 12 } },
    });
    const ev = evaluateDraft(pkg, doc);
    expect(ev.tracks!.unfit).toEqual([H]);
    expect(ev.complete).toBe(false);
    expect(ev.open).toEqual([]);
    expect(ev.tracks!.list.map((t) => t.levels)).toEqual([3, 2]);
    expect(ev.things.some((t) => t.id === "trait.green-thumb")).toBe(true);
  });
});

describe("changing the levels", () => {
  it("keeps the answers of a track taken away, and they count again when it is back", () => {
    const doc = build(L, [L, L, H, H], { scores: LANTERN_AND_HERBS });
    const single = apply(doc, { type: "tracks", tracks: [] });
    expect(single.tracks).toBeUndefined();
    const ev = evaluateDraft(pkg, single);
    expect(ev.inactiveAnswers).toContain("added-talent-herbalist@calling.herbalist");
    expect(ev.things.some((t) => t.id === H)).toBe(false);
    const back = apply(single, { type: "tracks", tracks: [L, L, H, H] });
    expect(back.answers).toEqual(doc.answers);
    expect(evaluateDraft(pkg, back).complete).toBe(true);
  });

  it("moves the levels of the old first track to a new one", () => {
    const doc = build(L, [L, H]);
    const changed = apply(doc, { type: "answer", choice: "calling", answer: { pick: R } });
    expect(changed.tracks).toEqual([R, H]);
    // A first track that was an added one takes its levels: one track left.
    const merged = apply(doc, { type: "answer", choice: "calling", answer: { pick: H } });
    expect(merged.tracks).toBeUndefined();
  });

  it("takes only callings, and no more than the levels", () => {
    const doc = build(L, [L]);
    expect(applyChange(pkg, doc, { type: "tracks", tracks: ["knack.eddy"] })).toEqual({
      ok: false,
      error: { code: "unknownTrack", thing: "knack.eddy" },
    });
    expect(applyChange(pkg, doc, { type: "tracks", tracks: [H, H] })).toEqual({
      ok: false,
      error: { code: "tooManyTracks", most: 1 },
    });
    expect(applyChange(plain, doc, { type: "tracks", tracks: [H] })).toEqual({
      ok: false,
      error: { code: "noTracks" },
    });
  });

  it("puts the tracks into the summary line", () => {
    const p = structuredClone(pkg);
    p.flow.summary.line = { calling: { tracks: true }, level: { value: "level" } };
    const doc = build(L, [H, H], { level: 3, p });
    expect(summarize(p, doc, evaluateDraft(p, doc)).line).toEqual({
      calling: [
        { thing: H, levels: 2 },
        { thing: L, levels: 1 },
      ],
      level: 3,
    });
  });
});
