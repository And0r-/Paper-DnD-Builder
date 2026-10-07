/**
 * The guided flow as the screens see it: level, the package's steps as the
 * rule core derives them, then the overview. Plus what a change would
 * break, so the screen can ask before it happens (flow spec 2.5).
 */
import {
  evaluateDraft,
  type ChoiceState,
  type DraftDocument,
  type Evaluation,
  type MeasureContext,
} from "@builder/core";
import type { ContentPackage } from "@builder/format/pure";
import type { Translator } from "../../i18n/index.ts";
import { choiceOf, choiceTexts, grantedValue, plain, ptext, stepTexts, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import type { Count } from "./plan.ts";

export type EntryStatus = "done" | "open" | "needsAttention";

export interface FlowEntry {
  /** "level", the step id, or "overview". */
  key: string;
  kind: "level" | "step" | "overview";
  href: string;
  title: string;
  status: EntryStatus;
  /** For package steps: the step's choices. */
  choices: string[];
  /**
   * The counted step this entry belongs to, from 0. Steps a choice brings
   * along (granted steps) are parts of the step they came from, so the
   * count never jumps when a choice adds them.
   */
  section: number;
  /** Position within the section, from 1, and how many parts it has. */
  part: number;
  parts: number;
  /** Key of the section's first entry. */
  sectionKey: string;
  /** Character level from which the entry is asked (`level.min` for the flow's own steps). */
  atLevel: number;
  /**
   * Name of the whole section when it differs from the first entry's title:
   * the package's title for a gather step whose choices stand one by one.
   */
  sectionTitle?: string;
  /**
   * The count shown for the entry, by the planned flow (plan.ts): the
   * total stands from the start instead of growing with each answer.
   */
  count?: Count;
}

export const LEVEL_KEY = "level";
export const OVERVIEW_KEY = "overview";

export function stepHref(draftId: string, key: string): string {
  if (key === LEVEL_KEY) return `/c/${draftId}/level`;
  if (key === OVERVIEW_KEY) return `/c/${draftId}/overview`;
  return `/c/${draftId}/step/${encodeURIComponent(key)}`;
}

export function buildFlow(
  draftId: string,
  lp: LoadedPackage,
  ev: Evaluation,
  t: Translator["t"],
): FlowEntry[] {
  const entries: FlowEntry[] = [
    {
      key: LEVEL_KEY,
      kind: "level",
      href: stepHref(draftId, LEVEL_KEY),
      title: ptext(lp, "level.name") ?? "",
      status: "done",
      choices: [],
      section: 0,
      part: 1,
      parts: 1,
      sectionKey: LEVEL_KEY,
      atLevel: lp.pkg.flow.level.min,
    },
  ];
  let section = 0;
  let sectionKey = LEVEL_KEY;
  let group: string | undefined;
  for (const s of ev.steps) {
    const gathered = gatherGroupOf(lp, s);
    const opens = s.origin === "flow" || (gathered !== undefined && gathered !== group);
    // The group changes only with a new section: a part that a gathered step
    // brought along (a raise after a boon) keeps the group, so the next step
    // of that group joins the same section, and the count stays the same when
    // an answer brings such a part.
    if (opens) {
      section++;
      sectionKey = s.id;
      group = gathered;
    }
    const sectionTitle = opens && gathered !== undefined ? gatherTitle(lp, gathered) : undefined;
    entries.push({
      key: s.id,
      kind: "step",
      href: stepHref(draftId, s.id),
      title: stepTexts(lp, s, ev).title,
      status: s.status,
      choices: s.choices.filter((c) => c in ev.choices),
      section,
      part: 1,
      parts: 1,
      sectionKey,
      atLevel: s.atLevel,
      ...(sectionTitle !== undefined && { sectionTitle }),
    });
  }
  entries.push({
    key: OVERVIEW_KEY,
    kind: "overview",
    href: stepHref(draftId, OVERVIEW_KEY),
    title: t("flow.overview"),
    status: ev.complete ? "done" : "open",
    choices: [],
    section: section + 1,
    part: 1,
    parts: 1,
    sectionKey: OVERVIEW_KEY,
    atLevel: lp.pkg.flow.level.min,
  });
  const sorted = byLevel(entries);
  for (const e of sorted) {
    const same = sorted.filter((x) => x.section === e.section);
    e.part = same.indexOf(e) + 1;
    e.parts = same.length;
  }
  return sorted;
}

/**
 * The steps of a section from the lowest level they come at to the highest,
 * so the list reads the way its span does ("Level 1 to 3"); steps of the
 * same level keep the package's order. A gathered group sorts all its steps
 * and the first one then leads it, with the group's name; any other section
 * keeps the step that opens it first and sorts what that step brought along.
 */
export function byLevel(entries: FlowEntry[]): FlowEntry[] {
  const out: FlowEntry[] = [];
  for (let i = 0; i < entries.length;) {
    let j = i;
    while (j < entries.length && entries[j]!.section === entries[i]!.section) j++;
    const section = entries.slice(i, j);
    const head = section[0]!;
    const title = head.sectionTitle;
    const sorted =
      title !== undefined
        ? section.toSorted((a, b) => a.atLevel - b.atLevel)
        : [head, ...section.slice(1).toSorted((a, b) => a.atLevel - b.atLevel)];
    const lead = sorted[0]!;
    for (const e of sorted) {
      e.sectionKey = lead.key;
      if (e !== lead) delete e.sectionTitle;
    }
    if (title !== undefined) lead.sectionTitle = title;
    out.push(...sorted);
    i = j;
  }
  return out;
}

/**
 * The gather group that placed a granted step, if the flow has a step for
 * that group. Such a step stands where the flow asks it, far from the
 * choice that brought it, so it counts on its own instead of as a part of
 * whatever step happens to come before it.
 */
export function gatherGroupOf(lp: LoadedPackage, step: Evaluation["steps"][number]): string | undefined {
  if (step.origin !== "granted") return undefined;
  const group = step.choices[0] !== undefined ? choiceOf(lp, step.choices[0])?.gather : undefined;
  if (group === undefined) return undefined;
  return lp.pkg.flow.steps.some((f) => "gather" in f && f.gather === group) ? group : undefined;
}

/** The package's title for the flow step that gathers `group`, if it has one. */
function gatherTitle(lp: LoadedPackage, group: string): string | undefined {
  const step = lp.pkg.flow.steps.find((f) => "gather" in f && f.gather === group);
  return step && ptext(lp, `step.${step.id}.title`);
}

// A type, not an interface: it fills message placeholders ({current}, {part}).
export type Position = {
  /** Counted step, from 1, and how many there are. */
  current: number;
  total: number;
  /** Part within that step, from 1; `parts` is 1 when the step has no parts. */
  part: number;
  parts: number;
  /** Title of the counted step (the entry that starts the section). */
  sectionTitle: string;
};

/**
 * Where an entry is: "Step 3 of 9", and "part 2 of 4" inside a step that
 * brought its own parts. Counted by the planned flow when the entry has its
 * count, else by the entries as they are. `parts` is 1 (no part count) on
 * an open step that has no parts yet, though the plan may give it some.
 */
export function positionOf(entries: FlowEntry[], entry: FlowEntry): Position {
  const last = entries.at(-1)!;
  const head = entries.find((e) => e.key === entry.sectionKey) ?? entry;
  const own = entries.find((e) => e.key === entry.key) ?? entry;
  const count = own.count;
  // A step that is one part as it stands, its choice still open, counts no
  // parts: the plan's parts are those of the suggestion, and which parts
  // come depends on the answer (AND-189). From the second part on the count
  // is the plan's again.
  const unsure = own.key === head.key && own.status !== "done" && own.parts === 1;
  return {
    current: count?.current ?? entry.section + 1,
    total: count?.total ?? last.section + 1,
    part: unsure ? 1 : (count?.part ?? entry.part),
    parts: unsure ? 1 : (count?.parts ?? entry.parts),
    sectionTitle: head.sectionTitle ?? head.title,
  };
}

/**
 * How far along, from 0 to 1: by screens of the planned flow, so every
 * screen moves the bar the same bit, the parts of a long step too.
 */
export function progressFraction(entries: FlowEntry[], entry: FlowEntry): number {
  const count = entries.find((e) => e.key === entry.key)?.count;
  if (count) return count.screen / count.screens;
  const p = positionOf(entries, entry);
  return (p.current - 1 + p.part / p.parts) / p.total;
}

/** Where "keep building" leads: the first step that is not done, else the overview. */
export function firstOpen(entries: FlowEntry[]): FlowEntry {
  return entries.find((e) => e.kind === "step" && e.status !== "done") ?? entries.at(-1)!;
}

/**
 * The step after `key` in the order of every step (`all`) that is still to
 * answer and one of the steps to go through (`entries`), else the overview.
 * During a level up an earlier step that had to be answered again leads on
 * to the new ones this way, though it is not one of them.
 */
export function nextOpen(all: FlowEntry[], entries: FlowEntry[], key: string): FlowEntry {
  const asked = new Set(entries.map((e) => e.key));
  const after = all.slice(all.findIndex((e) => e.key === key) + 1);
  return after.find((e) => e.kind === "step" && e.status !== "done" && asked.has(e.key)) ?? entries.at(-1)!;
}

/** Position for "Step 3 of 7": the first open step. */
export function progressOf(entries: FlowEntry[]): Position {
  return positionOf(entries, firstOpen(entries));
}

/** True if a choice holds an answer that counts right now. */
function holds(c: ChoiceState | undefined): boolean {
  return c !== undefined && c.answer !== undefined && (c.status === "answered" || c.status === "incomplete");
}

export interface Consequence {
  choice: string;
  /** Picks lost, for "(3 chosen)". */
  picked: number;
}

/**
 * Answers that fit before the change and would not fit (or not be asked)
 * after it. Answers are never deleted; this is only for the warning.
 */
export function consequences(
  pkg: ContentPackage,
  before: DraftDocument,
  after: DraftDocument,
): Consequence[] {
  const a = evaluateDraft(pkg, before);
  const b = evaluateDraft(pkg, after);
  const out: Consequence[] = [];
  for (const [id, state] of Object.entries(a.choices)) {
    if (!holds(state)) continue;
    const next = b.choices[id];
    if (next && next.status !== "invalid") continue;
    const ans = state.answer as { picks?: unknown[] } | undefined;
    out.push({ choice: id, picked: Array.isArray(ans?.picks) ? ans.picks.length : 1 });
  }
  return out;
}

/**
 * Steps that appear or disappear between two evaluations, and steps that
 * stay but ask more than before: a gather step that got a choice from a
 * later step (for the "a step was added" note).
 */
export function stepDiff(
  before: Evaluation,
  after: Evaluation,
): { added: string[]; removed: string[]; grown: string[] } {
  const was = new Map(before.steps.map((s) => [s.id, s]));
  const is = new Set(after.steps.map((s) => s.id));
  return {
    added: after.steps.filter((s) => !was.has(s.id)).map((s) => s.id),
    removed: before.steps.filter((s) => !is.has(s.id)).map((s) => s.id),
    grown: after.steps
      .filter((s) => {
        const old = was.get(s.id);
        return old !== undefined && s.choices.some((c) => !old.choices.includes(c));
      })
      .map((s) => s.id),
  };
}

export function stepTitle(lp: LoadedPackage, ev: Evaluation, stepId: string): string {
  const s = ev.steps.find((x) => x.id === stepId) ?? lp.pkg.flow.steps.find((x) => x.id === stepId);
  return s ? stepTexts(lp, s, ev).title : choiceTexts(lp, stepId, ev.choices[stepId]).title || stepId;
}

/** The answer to one choice in a short sentence, for the overview. */
export function describeAnswer(
  lp: LoadedPackage,
  ctx: MeasureContext,
  state: ChoiceState,
  list: Translator["list"],
  /** Values said elsewhere on the screen (what grows with the level), left out here. */
  skipValues: ReadonlySet<string> = new Set(),
  /** The character's values, so a thing that gives a whole value says it without a sign. */
  values?: Readonly<Record<string, number>>,
): string | undefined {
  const answer = state.answer as Record<string, unknown> | undefined;
  const choice = choiceOf(lp, state.id);
  if (!choice) return undefined;
  switch (state.kind) {
    case "info":
    case "pickOne":
    case "pickMany": {
      const p = answerThings(lp, ctx, state, skipValues, values);
      const parts = p ? [...p.things.map((id) => thingName(lp, id)), ...p.values] : [];
      return parts.length > 0 ? list(parts) : undefined;
    }
    case "distribute": {
      const assign = answer?.["assign"] as Record<string, number> | undefined;
      if (!assign || choice.kind !== "distribute") return undefined;
      // Raised values: only those that got points, as "+2".
      if (choice.methods[0]?.method === "raise")
        return choice.targets
          .filter((v) => (assign[v] ?? 0) > 0)
          .map((v) => `${ptext(lp, `value.${v}.name`) ?? v} +${assign[v]}`)
          .join(" · ");
      return choice.targets
        .map((v) => `${ptext(lp, `value.${v}.name`) ?? v} ${assign[v] ?? "–"}`)
        .join(" · ");
    }
    case "number":
      return typeof answer?.["value"] === "number"
        ? new Intl.NumberFormat(lp.lang).format(answer["value"])
        : undefined;
    case "text":
      return typeof answer?.["text"] === "string" && answer["text"].trim()
        ? answer["text"].trim()
        : undefined;
  }
}

/**
 * The things an answer names (picked or brought along) and, for what a
 * thing brings, the values it adds. Undefined for answers that are no things.
 */
export function answerThings(
  lp: LoadedPackage,
  ctx: MeasureContext,
  state: ChoiceState,
  skipValues: ReadonlySet<string> = new Set(),
  values?: Readonly<Record<string, number>>,
): { things: string[]; values: string[] } | undefined {
  const answer = state.answer as Record<string, unknown> | undefined;
  switch (state.kind) {
    case "info":
      return state.info
        ? {
            things: state.info.things,
            values: state.info.values
              .filter((v) => !skipValues.has(v.value))
              .map((v) => grantedValue(lp, ctx, v.value, v.add, values?.[v.value])),
          }
        : undefined;
    case "pickOne":
      return typeof answer?.["pick"] === "string" ? { things: [answer["pick"]], values: [] } : undefined;
    case "pickMany":
      return Array.isArray(answer?.["picks"])
        ? { things: answer["picks"] as string[], values: [] }
        : undefined;
    default:
      return undefined;
  }
}

/** "Choose 1 more talent" from the package, or the builder's own words. */
export function missingText(
  lp: LoadedPackage,
  ctx: MeasureContext,
  state: ChoiceState,
  t: Translator["t"],
): string {
  if (state.status === "invalid") return t("flow.needsAttention");
  const own = choiceTexts(lp, state.id, state, ctx).missing;
  const count = state.count ?? 0;
  const remaining = state.remaining ?? count;
  if (own) return plain(ctx, own, { remaining, count });
  if (state.kind === "pickMany") {
    return t("pick.missing", { remaining, picked: count - remaining, count });
  }
  if (state.kind === "pickOne") return t("pick.missingOne");
  return t("flow.missingGeneric");
}
