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
    },
  ];
  for (const s of ev.steps) {
    entries.push({
      key: s.id,
      kind: "step",
      href: stepHref(draftId, s.id),
      title: stepTexts(lp, s, ev).title,
      status: s.status,
      choices: s.choices.filter((c) => c in ev.choices),
    });
  }
  entries.push({
    key: OVERVIEW_KEY,
    kind: "overview",
    href: stepHref(draftId, OVERVIEW_KEY),
    title: t("flow.overview"),
    status: ev.complete ? "done" : "open",
    choices: [],
  });
  return entries;
}

/** Where "keep building" leads: the first step that is not done, else the overview. */
export function firstOpen(entries: FlowEntry[]): FlowEntry {
  return entries.find((e) => e.kind === "step" && e.status !== "done") ?? entries.at(-1)!;
}

/** Position for "Step 3 of 7": the first open step, counted from 1. */
export function progressOf(entries: FlowEntry[]): { current: number; total: number } {
  const open = firstOpen(entries);
  return { current: entries.indexOf(open) + 1, total: entries.length };
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
  if (own && (state.kind === "pickMany" || state.kind === "distribute")) {
    return plain(ctx, own, { remaining, count });
  }
  if (state.kind === "pickMany") {
    return t("pick.missing", { remaining, picked: count - remaining, count });
  }
  if (state.kind === "pickOne") return t("pick.missingOne");
  return t("flow.missingGeneric");
}
