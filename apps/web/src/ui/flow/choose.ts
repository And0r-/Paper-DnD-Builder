/**
 * "Choose for me" on one step: the changes it sends. It answers the open
 * choices with the package's recommendation, but
 *
 * - keeps what an answer already picks: a step that grew with the level
 *   (more picks at level 20 than at level 1) only fills the new places;
 * - leaves out what the character has from another choice or thing: picking
 *   it here would make that other answer stop fitting, the same thing the
 *   step asks about before a tap does it (guard.tsx).
 */
import {
  applyChange,
  evaluateDraft,
  fillPicks,
  isSettled,
  type ChoiceState,
  type DraftChange,
  type DraftDocument,
  type Evaluation,
  type PoolState,
} from "@builder/core";
import type { Choice } from "@builder/format/pure";
import { choiceOf, plist } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { onlyTextsMissing } from "./model.ts";

/** Things the character has that did not come from one of `own` (choice ids); repeatable things never count. */
export function heldElsewhere(lp: LoadedPackage, ev: Evaluation, own: ReadonlySet<string>): Set<string> {
  const repeatable = new Set(lp.pkg.things.filter((t) => t.repeatable).map((t) => t.id));
  return new Set(
    ev.things
      .filter((h) => !repeatable.has(h.id) && (h.pickedIn === undefined || !own.has(h.pickedIn)))
      .map((h) => h.id),
  );
}

/** Picks an answer already has that still fit. */
function keptPicks(state: ChoiceState): string[] {
  const offered = new Set(state.options ?? []);
  const answer = state.answer as { pick?: unknown; picks?: unknown } | undefined;
  const picks = Array.isArray(answer?.picks) ? answer.picks : answer?.pick !== undefined ? [answer.pick] : [];
  return picks.filter((p): p is string => typeof p === "string" && offered.has(p));
}

/** The answer "choose for me" gives one open choice, or undefined if the package suggests nothing. */
export function suggestedAnswer(
  lp: LoadedPackage,
  def: Choice,
  state: ChoiceState,
  away: ReadonlySet<string>,
  random: () => number = Math.random,
): DraftChange | undefined {
  const rec = state.recommended;
  const answer = (a: unknown): DraftChange => ({ type: "answer", choice: state.id, answer: a });
  if ((def.kind === "pickOne" || def.kind === "pickMany") && Array.isArray(rec) && rec.length > 0) {
    // Words the player writes for a pick (`textInputs`) cannot be chosen for them.
    if (onlyTextsMissing(state)) return undefined;
    const count = def.kind === "pickOne" ? 1 : (state.count ?? rec.length);
    const picks = keptPicks(state).slice(0, count);
    // A pick among what the character has (`owned`) marks it; it is not given again.
    const skip = def.options.owned ? new Set<string>() : away;
    // The package's picks first; when it named fewer than are free now, the list fills up.
    for (const id of [...rec, ...(state.options ?? [])]) {
      if (picks.length >= count) break;
      if (!picks.includes(id) && !skip.has(id)) picks.push(id);
    }
    if (picks.length === 0) return undefined;
    const texts = (state.answer as { texts?: unknown } | undefined)?.texts;
    const kept = texts !== undefined ? { texts } : {};
    return answer(def.kind === "pickOne" ? { pick: picks[0], ...kept } : { picks, ...kept });
  }
  if (def.kind === "distribute" && rec && !Array.isArray(rec)) return answer(rec);
  if (def.kind === "number" && def.default !== undefined) return answer({ value: def.default });
  if (def.kind === "text" && def.suggestions) {
    const list = plist(lp, def.suggestions);
    if (list.length > 0) return answer({ text: list[Math.floor(random() * list.length)]! });
  }
  return undefined;
}

/** The picks of a shared list: the ones there, then the recommendation, then the list. */
export function suggestedPool(lp: LoadedPackage, ev: Evaluation, pool: PoolState): string[] {
  const away = heldElsewhere(lp, ev, new Set(pool.choices.map((c) => c.choice)));
  const slots = pool.choices.map((c) => ({ count: c.count, offers: new Set(c.options) }));
  return fillPicks(
    slots,
    [...pool.picks, ...pool.recommended, ...pool.options].filter(
      (p) => pool.picks.includes(p) || !away.has(p),
    ),
  );
}

/**
 * Every change "choose for me" makes on step `stepId`, in order, or
 * undefined if it cannot answer all that is open there. Choices of one
 * step are answered one after the other: what the first one picks is not
 * picked again by the next.
 */
export function chooseForMe(
  lp: LoadedPackage,
  doc: DraftDocument,
  ev: Evaluation,
  stepId: string,
  random: () => number = Math.random,
): DraftChange[] | undefined {
  const step = ev.steps.find((s) => s.id === stepId);
  if (!step) return undefined;
  const choices = step.choices.filter((c) => c in ev.choices);
  if (step.pool) {
    const open = choices.map((c) => ev.choices[c]!).filter((c) => !isSettled(c));
    if (open.every(onlyTextsMissing)) return undefined;
    const picks = suggestedPool(lp, ev, step.pool);
    return picks.length > 0 ? [{ type: "pool", step: stepId, picks }] : undefined;
  }
  const open = choices.filter((c) => !isSettled(ev.choices[c]!));
  if (open.length === 0) return undefined;
  const changes: DraftChange[] = [];
  let d = doc;
  let e = ev;
  for (const [i, id] of open.entries()) {
    const state = e.choices[id];
    const def = choiceOf(lp, id);
    if (!state || !def) return undefined;
    const c = suggestedAnswer(lp, def, state, heldElsewhere(lp, e, new Set([id])), random);
    if (!c) return undefined;
    changes.push(c);
    if (i < open.length - 1) {
      const r = applyChange(lp.pkg, d, c);
      if (!r.ok) return undefined;
      d = r.doc;
      e = evaluateDraft(lp.pkg, d);
    }
  }
  return changes;
}
