/**
 * The count a player sees ("Step 3 of 16", "Part 2 of 10") is the count of
 * the planned flow: the draft as it will be once every open choice takes
 * the suggestion ("choose for me"). So the total stands from the first
 * screen on; a player who follows the suggestions never sees it change, and
 * one who picks something else sees it change with a note (AND-77).
 */
import {
  applyChange,
  evaluateDraft,
  isSettled,
  type DraftChange,
  type DraftDocument,
  type Evaluation,
} from "@builder/core";
import { choiceOf } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { heldElsewhere, suggestedAnswer, suggestedPool } from "./choose.ts";
import type { FlowEntry } from "./model.ts";

/** Rounds of filling at most: each round reaches the choices the last one brought. */
const ROUNDS = 12;

const plans = new WeakMap<LoadedPackage["pkg"], WeakMap<DraftDocument, DraftDocument>>();

/**
 * The draft with every open choice answered by the suggestion, answers
 * already given kept. A pick choice without a suggestion takes its first
 * option: for the count, some answer is better than none. Texts are left
 * out; they bring no steps.
 *
 * One evaluation per round: every choice open in it is answered at once,
 * written straight into the answers (the rule core judges them when it
 * evaluates); a thing picked in one choice is not picked again in the next.
 * The next round answers what those answers brought.
 */
export function plannedDraft(lp: LoadedPackage, doc: DraftDocument): DraftDocument {
  let byDoc = plans.get(lp.pkg);
  if (!byDoc) plans.set(lp.pkg, (byDoc = new WeakMap()));
  const cached = byDoc.get(doc);
  if (cached) return cached;
  // A thing that can be had more than once may be picked again (as in heldElsewhere).
  const repeatable = new Set(lp.pkg.things.filter((t) => t.repeatable).map((t) => t.id));
  let d = doc;
  for (let round = 0; round < ROUNDS; round++) {
    const ev = evaluateDraft(lp.pkg, d);
    const answers = { ...d.answers };
    const taken = new Set<string>();
    const pools: DraftChange[] = [];
    let changed = false;
    // The rule core's suggestion for a choice leaves out what is already picked
    // and names the next ones instead. A choice whose suggestion holds a thing
    // picked earlier in this round is answered from a fresh evaluation, as
    // "choose for me" does one screen after the other (AND-90).
    let now = ev;
    for (const step of ev.steps) {
      if (step.status === "done") continue;
      if (step.pool) {
        if (step.choices.some((c) => ev.choices[c] && !isSettled(ev.choices[c]))) {
          pools.push({ type: "pool", step: step.id, picks: suggestedPool(lp, ev, step.pool) });
        }
        continue;
      }
      for (const id of step.choices) {
        const rec = now.choices[id]?.recommended;
        if (Array.isArray(rec) && rec.some((p) => taken.has(p)))
          now = evaluateDraft(lp.pkg, { ...d, answers });
        const c = suggestion(lp, now, id, taken);
        if (c?.type !== "answer") continue;
        if (JSON.stringify(answers[id]) !== JSON.stringify(c.answer)) changed = true;
        answers[id] = c.answer;
        const a = c.answer as { pick?: unknown; picks?: unknown };
        for (const p of Array.isArray(a.picks) ? a.picks : [a.pick])
          if (typeof p === "string" && !repeatable.has(p)) taken.add(p);
      }
    }
    let next: DraftDocument = { ...d, answers };
    for (const c of pools) {
      const r = applyChange(lp.pkg, next, c);
      if (r.ok) next = r.doc;
    }
    if (!changed && pools.length === 0) break;
    d = next;
  }
  byDoc.set(doc, d);
  return d;
}

/** The suggestion for one open choice, leaving out what is held elsewhere or `taken` this round. */
function suggestion(
  lp: LoadedPackage,
  ev: Evaluation,
  id: string,
  taken: ReadonlySet<string>,
): DraftChange | undefined {
  const state = ev.choices[id];
  const def = choiceOf(lp, id);
  if (!state || !def || isSettled(state) || state.status === "invalid" || def.kind === "text")
    return undefined;
  const rec = state.recommended;
  const known = Array.isArray(rec) ? rec.length > 0 : rec !== undefined;
  const away = heldElsewhere(lp, ev, new Set([id]));
  for (const t of taken) away.add(t);
  return suggestedAnswer(
    lp,
    def,
    known ? state : { ...state, recommended: state.options ?? [] },
    away,
    () => 0,
  );
}

/** The count of an entry: step and part as the planned flow numbers them, and the screen for the bar. */
export interface Count {
  /** Counted step, from 1, and how many there will be. */
  current: number;
  total: number;
  /** Part within that step, from 1, and how many it will have. */
  part: number;
  parts: number;
  /** Screen from 1, and how many screens in all (for the bar). */
  screen: number;
  screens: number;
}

/**
 * Numbers the entries the player goes through by the planned flow. An
 * entry the plan does not have (a step that only the given answers bring)
 * joins the step of the entry before it, as one more part.
 */
export function countByPlan(entries: FlowEntry[], planned: FlowEntry[]): Map<string, Count> {
  const real = new Set(entries.map((e) => e.key));
  const plannedKeys = new Set(planned.map((e) => e.key));
  // The plan's order, with the entries it does not know behind the entry they follow.
  const merged: { key: string; section: number }[] = planned.map((e) => ({ key: e.key, section: e.section }));
  for (const [i, e] of entries.entries()) {
    if (plannedKeys.has(e.key)) continue;
    const prev = i > 0 ? merged.findIndex((m) => m.key === entries[i - 1]!.key) : -1;
    merged.splice(prev + 1, 0, { key: e.key, section: prev >= 0 ? merged[prev]!.section : 0 });
  }
  const sections = [...new Set(merged.map((m) => m.section))];
  const out = new Map<string, Count>();
  for (const [i, m] of merged.entries()) {
    if (!real.has(m.key)) continue;
    const same = merged.filter((x) => x.section === m.section);
    out.set(m.key, {
      current: sections.indexOf(m.section) + 1,
      total: sections.length,
      part: same.indexOf(m) + 1,
      parts: same.length,
      screen: i + 1,
      screens: merged.length,
    });
  }
  return out;
}

/**
 * What a change did to the planned flow, as titles: whole steps that came or
 * went (they change "Step x of y"), and parts that came or went within a
 * step that stays (they change "Part x of y").
 *
 * A step that went and one that came under the same name are one step to
 * the player and are not named (AND-100). `asked` tells, for the flow it
 * belongs to, whether the parts of a step are worth a word: parts that a
 * step without an answer has only by its suggestion are left out, so no
 * one hears of a part of a choice they never made.
 */
export function planDiff(
  before: FlowEntry[],
  after: FlowEntry[],
  asked: (head: FlowEntry, side: "before" | "after") => boolean = () => true,
): { added: string[]; removed: string[]; addedParts: string[]; removedParts: string[] } {
  const gone = (from: FlowEntry[], to: FlowEntry[], side: "before" | "after") => {
    const keys = new Set(to.map((e) => e.key));
    const steps: { title: string; parts: string[]; asked: boolean }[] = [];
    const parts: string[] = [];
    for (const e of from) {
      if (keys.has(e.key)) continue;
      // A step none of whose entries is on the other side is a whole step; else a part of one.
      const section = from.filter((x) => x.section === e.section);
      if (section.some((x) => keys.has(x.key))) {
        if (asked(section[0]!, side)) parts.push(e.title);
      } else if (e === section[0]) {
        const title = e.sectionTitle ?? e.title;
        steps.push({ title, parts: section.map((x) => x.title), asked: asked(e, side) });
      }
    }
    return { steps, parts };
  };
  const added = gone(after, before, "after");
  const removed = gone(before, after, "before");
  const [addedSteps, removedSteps] = withoutSame(
    added.steps.map((s) => s.title),
    removed.steps.map((s) => s.title),
  );
  // A step that went and came under the same name stays; the parts it lost or got are named (AND-138).
  const rest = [...added.steps];
  for (const old of removed.steps) {
    const i = rest.findIndex((s) => s.title === old.title);
    if (i < 0) continue;
    const [now] = rest.splice(i, 1);
    const [came, went] = withoutSame(now!.parts, old.parts);
    if (now!.asked) added.parts.push(...came);
    if (old.asked) removed.parts.push(...went);
  }
  const [addedParts, removedParts] = withoutSame(added.parts, removed.parts);
  return { added: addedSteps, removed: removedSteps, addedParts, removedParts };
}

/** Both lists without the names they share, each as often as both have it. */
function withoutSame(a: string[], b: string[]): [string[], string[]] {
  const rest = [...b];
  const kept = a.filter((name) => {
    const i = rest.indexOf(name);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
  return [kept, rest];
}
