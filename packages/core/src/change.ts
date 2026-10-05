/**
 * Creating and changing drafts. Every edit of a draft, from whatever
 * client, goes through {@link applyChange}: the server applies it, stores
 * the result and (later) tells everyone else watching the same draft.
 */
import { declaredChoiceId, type ContentPackage } from "@builder/format/pure";
import type { DraftChange, DraftDocument } from "./draft.ts";
import { evaluateDraft, type Evaluation } from "./evaluate.ts";
import { judgeAnswer, type Problem } from "./judge.ts";
import { assignPicks } from "./pool.ts";

export type ChangeError =
  | { code: "levelOutOfRange"; min: number; max: number }
  | { code: "unknownChoice" }
  | { code: "notAsked" }
  /** `pool`: the step is not asked now or has no shared list. */
  | { code: "unknownStep" }
  | { code: "noAnswerNeeded" }
  | { code: "answerDoesNotFit"; problem: Problem };

export type ChangeResult = { ok: true; doc: DraftDocument } | { ok: false; error: ChangeError };

export function newDraft(pkg: ContentPackage, level = pkg.flow.level.default): ChangeResult {
  const range = levelRange(pkg, level);
  if (range) return { ok: false, error: range };
  return { ok: true, doc: { level, answers: {} } };
}

function levelRange(pkg: ContentPackage, level: number): ChangeError | undefined {
  const { min, max } = pkg.flow.level;
  if (!Number.isInteger(level) || level < min || level > max) return { code: "levelOutOfRange", min, max };
  return undefined;
}

/**
 * Applies one change. A new answer must fit the choice as it is asked right
 * now; answers further down that stop fitting are kept and marked by the
 * evaluation, so going back restores them.
 */
export function applyChange(pkg: ContentPackage, doc: DraftDocument, change: DraftChange): ChangeResult {
  if (change.type === "setLevel") {
    const range = levelRange(pkg, change.level);
    if (range) return { ok: false, error: range };
    return { ok: true, doc: { ...doc, level: change.level } };
  }

  if (change.type === "pool") return applyPool(pkg, doc, change.step, change.picks);

  const declared = declaredChoiceId(change.choice);
  const choice = pkg.flow.choices.find((c) => c.id === declared);
  if (!choice) return { ok: false, error: { code: "unknownChoice" } };
  if (change.answer === null || change.answer === undefined) {
    const answers = { ...doc.answers };
    delete answers[change.choice];
    return { ok: true, doc: { ...doc, answers } };
  }
  if (choice.kind === "info") return { ok: false, error: { code: "noAnswerNeeded" } };

  const ev = evaluateDraft(pkg, doc);
  const state = ev.choices[change.choice];
  if (!state) return { ok: false, error: { code: "notAsked" } };
  // On a list step a thing counts for one choice only.
  const pool = ev.steps.find((s) => s.id === state.step)?.pool;
  const taken = new Set(pool?.choices.filter((c) => c.choice !== change.choice).flatMap((c) => c.picks));
  const ctx = {
    ...(state.options ? { options: state.options.filter((o) => !taken.has(o)) } : {}),
    ...(state.count !== undefined ? { count: state.count } : {}),
    ...(state.min !== undefined ? { min: state.min } : {}),
    ...(state.max !== undefined ? { max: state.max } : {}),
    ...(state.raise ? { raise: state.raise } : {}),
  };
  const j = judgeAnswer(choice, change.answer, ctx);
  if (j.status === "invalid") {
    return { ok: false, error: { code: "answerDoesNotFit", problem: j.problem ?? "badShape" } };
  }
  return { ok: true, doc: { ...doc, answers: { ...doc.answers, [change.choice]: change.answer } } };
}

function applyPool(pkg: ContentPackage, doc: DraftDocument, stepId: string, picks: string[]): ChangeResult {
  const ev = evaluateDraft(pkg, doc);
  const pool = ev.steps.find((s) => s.id === stepId)?.pool;
  if (!pool) return { ok: false, error: { code: "unknownStep" } };
  const doesNotFit = (problem: Problem): ChangeResult => ({
    ok: false,
    error: { code: "answerDoesNotFit", problem },
  });
  if (new Set(picks).size !== picks.length) return doesNotFit("duplicate");
  if (picks.some((p) => !pool.options.includes(p))) return doesNotFit("notOffered");
  if (picks.length > pool.count) return doesNotFit("tooMany");
  const slots = pool.choices.map((c) => ({ count: c.count, offers: new Set(ev.choices[c.choice]!.options) }));
  const keep = new Map(pool.choices.flatMap((c, i) => c.picks.map((p) => [p, i] as const)));
  const at = assignPicks(slots, picks, keep);
  if (!at) return doesNotFit("notOffered");
  const answers = { ...doc.answers };
  pool.choices.forEach((c, i) => {
    const mine = picks.filter((p) => at.get(p) === i);
    const kind = ev.choices[c.choice]!.kind;
    if (mine.length === 0) delete answers[c.choice];
    else answers[c.choice] = kind === "pickOne" ? { pick: mine[0] } : { picks: mine };
  });
  return { ok: true, doc: { ...doc, answers } };
}

/** What a character list shows: the name and the arguments of the `summary.line` text. */
export interface DraftSummary {
  name: string | null;
  level: number;
  complete: boolean;
  /** By variable name: a thing key (for `{ choice }`) or a number (for `{ value }`). */
  line: Record<string, string | number | null>;
}

export function summarize(pkg: ContentPackage, doc: DraftDocument, ev: Evaluation): DraftSummary {
  const nameState = ev.choices[pkg.flow.characterName];
  const name =
    nameState?.status === "answered" ? ((nameState.answer as { text: string }).text.trim() ?? null) : null;
  const line: DraftSummary["line"] = {};
  for (const [key, arg] of Object.entries(pkg.flow.summary.line)) {
    if ("choice" in arg) {
      const held = ev.things.find((t) => t.pickedIn === arg.choice);
      line[key] = held?.id ?? null;
    } else {
      line[key] = arg.value === "level" ? doc.level : (ev.values[arg.value] ?? null);
    }
  }
  return { name, level: doc.level, complete: ev.complete, line };
}
