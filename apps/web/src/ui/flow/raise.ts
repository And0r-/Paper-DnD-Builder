/**
 * Raising a finished character (plan 4.2): the flow then asks only what the
 * new levels bring. Which steps those are is worked out from the document
 * alone (the level it was finished at against the level now), so the list
 * stays the same while the player answers, and after a reload.
 */
import { evaluateDraft, type DraftDocument, type Evaluation } from "@builder/core";
import type { ContentPackage } from "@builder/format/pure";
import type { Translator } from "../../i18n/index.ts";
import type { LoadedPackage } from "../packages.ts";
import { buildFlow, type FlowEntry } from "./model.ts";
import { countByPlan, plannedDraft } from "./plan.ts";

/** A raise under way: from the level the character was finished at, to the level now. */
export interface Raise {
  from: number;
  to: number;
}

/**
 * The flow of a draft: every step (`all`, for the overview), and the steps
 * to go through (`entries`), which during a raise are only the new ones.
 * Each entry to go through carries its count by the planned flow (plan.ts).
 */
export function flowOf(
  draftId: string,
  lp: LoadedPackage,
  doc: DraftDocument,
  ev: Evaluation,
  t: Translator["t"],
): { all: FlowEntry[]; entries: FlowEntry[]; raise: Raise | null } {
  const all = buildFlow(draftId, lp, ev, t);
  const plan = plannedDraft(lp, doc);
  const planEv = plan === doc ? ev : evaluateDraft(lp.pkg, plan);
  const planAll = plan === doc ? all : buildFlow(draftId, lp, planEv, t);
  const from = doc.levelBefore;
  if (from === undefined || from >= doc.level) return { all, entries: counted(all, planAll), raise: null };
  const before = evaluateBefore(lp.pkg, doc, from);
  const ids = raiseStepIds(before, ev, from);
  const entries = raiseFlow(all, ids, from, doc.level);
  // The steps the plan's new levels ask, and every step asked now.
  const planIds = new Set([...raiseStepIds(before, planEv, from), ...ids]);
  const planned = raiseFlow(planAll, planIds, from, doc.level);
  return { all, entries: counted(entries, planned), raise: { from, to: doc.level } };
}

function counted(entries: FlowEntry[], planned: FlowEntry[]): FlowEntry[] {
  const counts = countByPlan(entries, planned);
  return entries.map((e) => {
    const count = counts.get(e.key);
    return count ? { ...e, count } : e;
  });
}

/** The character as it was before the raise: same answers, the old level. */
export function evaluateBefore(pkg: ContentPackage, doc: DraftDocument, from: number): Evaluation {
  return evaluateDraft(pkg, { level: from, answers: doc.answers });
}

/**
 * Steps a raise from level `from` asks: steps the new levels add, steps
 * with a choice they add (a gather step), steps whose choice asks for more
 * than before (a pick count from a table by level), and any step not done.
 */
export function raiseStepIds(before: Evaluation, after: Evaluation, from: number): Set<string> {
  const was = new Set(before.steps.map((s) => s.id));
  const grew = (id: string): boolean => {
    const now = after.choices[id];
    const old = before.choices[id];
    if (!now) return false;
    if (!old || now.atLevel > from) return true;
    return (now.count ?? 0) > (old.count ?? 0) || (now.raise?.points ?? 0) > (old.raise?.points ?? 0);
  };
  return new Set(
    after.steps
      .filter((s) => !was.has(s.id) || s.atLevel > from || s.status !== "done" || s.choices.some(grew))
      .map((s) => s.id),
  );
}

/**
 * The flow of a raise: the steps it asks, then the overview, counted from 1
 * again ("Step 1 of 3"). A step keeps the level it comes at; one that was
 * there before and only asks more says the new level when the raise is one
 * level (the level it grew at is not known otherwise).
 */
export function raiseFlow(all: FlowEntry[], ids: ReadonlySet<string>, from: number, to: number): FlowEntry[] {
  const kept = all.filter((e) => e.kind === "overview" || ids.has(e.key));
  const sections = [...new Set(kept.map((e) => e.section))];
  const out = kept.map((e) => ({
    ...e,
    section: sections.indexOf(e.section),
    atLevel: e.kind === "step" && e.atLevel <= from && to === from + 1 ? to : e.atLevel,
  }));
  for (const e of out) {
    const same = out.filter((x) => x.section === e.section);
    const head = same[0]!;
    // A section whose first step was asked before: the first one asked now leads it, with the section's name.
    const original = all.find((x) => x.key === e.sectionKey);
    e.part = same.indexOf(e) + 1;
    e.parts = same.length;
    e.sectionKey = head.key;
    if (e === head && original?.sectionTitle !== undefined) e.sectionTitle = original.sectionTitle;
    else if (e !== head) delete e.sectionTitle;
  }
  return out;
}

/** What a raise brought: things the character has now and did not have, and values that changed. */
export interface RaiseNews {
  things: string[];
  values: { id: string; before: number; after: number }[];
}

export function raiseNews(before: Evaluation, after: Evaluation, values: readonly string[]): RaiseNews {
  const had = new Set(before.things.map((h) => h.id));
  return {
    things: [...new Set(after.things.map((h) => h.id))].filter((id) => !had.has(id)),
    values: values
      .filter((id) => (after.values[id] ?? 0) !== (before.values[id] ?? 0))
      .map((id) => ({ id, before: before.values[id] ?? 0, after: after.values[id] ?? 0 })),
  };
}
