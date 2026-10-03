/**
 * Creating and changing drafts. Every edit of a draft, from whatever
 * client, goes through {@link applyChange}: the server applies it, stores
 * the result and (later) tells everyone else watching the same draft.
 */
import type { ContentPackage } from "@builder/format/pure";
import type { DraftChange, DraftDocument } from "./draft.ts";
import { evaluateDraft, type Evaluation } from "./evaluate.ts";
import { judgeAnswer, type Problem } from "./judge.ts";

export type ChangeError =
  | { code: "levelOutOfRange"; min: number; max: number }
  | { code: "unknownChoice" }
  | { code: "notAsked" }
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

  const choice = pkg.flow.choices.find((c) => c.id === change.choice);
  if (!choice) return { ok: false, error: { code: "unknownChoice" } };
  if (change.answer === null || change.answer === undefined) {
    const answers = { ...doc.answers };
    delete answers[change.choice];
    return { ok: true, doc: { ...doc, answers } };
  }
  if (choice.kind === "info") return { ok: false, error: { code: "noAnswerNeeded" } };

  const state = evaluateDraft(pkg, doc).choices[change.choice];
  if (!state) return { ok: false, error: { code: "notAsked" } };
  const ctx = {
    ...(state.options ? { options: state.options } : {}),
    ...(state.count !== undefined ? { count: state.count } : {}),
    ...(state.min !== undefined ? { min: state.min } : {}),
    ...(state.max !== undefined ? { max: state.max } : {}),
  };
  const j = judgeAnswer(choice, change.answer, ctx);
  if (j.status === "invalid") {
    return { ok: false, error: { code: "answerDoesNotFit", problem: j.problem ?? "badShape" } };
  }
  return { ok: true, doc: { ...doc, answers: { ...doc.answers, [change.choice]: change.answer } } };
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
