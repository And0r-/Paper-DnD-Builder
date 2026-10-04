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
import { choiceTexts, grantedValue, plain, ptext, stepTexts, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";

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
    },
  ];
  let section = 0;
  let sectionKey = LEVEL_KEY;
  for (const s of ev.steps) {
    if (s.origin === "flow") {
      section++;
      sectionKey = s.id;
    }
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
  });
  for (const e of entries) {
    const same = entries.filter((x) => x.section === e.section);
    e.part = same.indexOf(e) + 1;
    e.parts = same.length;
  }
  return entries;
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

/** Where an entry is: "Step 3 of 9", and "part 2 of 4" inside a step that brought its own parts. */
export function positionOf(entries: FlowEntry[], entry: FlowEntry): Position {
  const last = entries.at(-1)!;
  const head = entries.find((e) => e.key === entry.sectionKey) ?? entry;
  return {
    current: entry.section + 1,
    total: last.section + 1,
    part: entry.part,
    parts: entry.parts,
    sectionTitle: head.title,
  };
}

/**
 * How far along, from 0 to 1, by position: each counted step weighs the
 * same, split among its parts. Moving on never makes the bar shorter, even
 * when a choice brings new parts.
 */
export function progressFraction(entries: FlowEntry[], entry: FlowEntry): number {
  const p = positionOf(entries, entry);
  return (p.current - 1 + p.part / p.parts) / p.total;
}

/** Where "keep building" leads: the first step that is not done, else the overview. */
export function firstOpen(entries: FlowEntry[]): FlowEntry {
  return entries.find((e) => e.kind === "step" && e.status !== "done") ?? entries.at(-1)!;
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

/** Steps that appear or disappear between two evaluations (for the "a step was added" note). */
export function stepDiff(before: Evaluation, after: Evaluation): { added: string[]; removed: string[] } {
  const was = new Set(before.steps.map((s) => s.id));
  const is = new Set(after.steps.map((s) => s.id));
  return {
    added: after.steps.filter((s) => !was.has(s.id)).map((s) => s.id),
    removed: before.steps.filter((s) => !is.has(s.id)).map((s) => s.id),
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
): string | undefined {
  const answer = state.answer as Record<string, unknown> | undefined;
  const choice = lp.pkg.flow.choices.find((c) => c.id === state.id);
  if (!choice) return undefined;
  switch (state.kind) {
    case "info": {
      const info = state.info;
      if (!info) return undefined;
      const parts = [
        ...info.things.map((id) => thingName(lp, id)),
        ...info.values.map((v) => grantedValue(lp, ctx, v.value, v.add)),
      ];
      return parts.length > 0 ? list(parts) : undefined;
    }
    case "pickOne":
      return typeof answer?.["pick"] === "string" ? thingName(lp, answer["pick"]) : undefined;
    case "pickMany":
      return Array.isArray(answer?.["picks"]) && answer["picks"].length > 0
        ? list((answer["picks"] as string[]).map((id) => thingName(lp, id)))
        : undefined;
    case "distribute": {
      const assign = answer?.["assign"] as Record<string, number> | undefined;
      if (!assign || choice.kind !== "distribute") return undefined;
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
