/**
 * Checks one answer against its choice in the current situation.
 *
 * Used twice: by the evaluation (does a stored answer still fit?) and
 * before storing a new answer (reject what does not fit now).
 */
import type { Choice, TextInput } from "@builder/format/pure";
import { answerSchemaFor, type Answer, type DistributeAnswer, type PickTexts } from "./draft.ts";

/** Machine-readable reason why an answer does not fit. The UI words it. */
export type Problem =
  | "badShape"
  | "duplicate"
  | "notOffered"
  | "tooMany"
  | "badMethod"
  | "badAssignment"
  | "overBudget"
  | "outOfRange"
  | "empty"
  | "tooLong"
  | "badCharacters";

/** What the evaluation knows about a choice right now. */
export interface ChoiceContext {
  /** Things that may be picked (pick choices). */
  options?: readonly string[];
  /** How many to pick (pickMany). */
  count?: number;
  /** Allowed range (number choices). */
  min?: number;
  max?: number;
  /** Distribute choices with `raise`: points in all and the most each target can take. */
  raise?: { points: number; most: Record<string, number> };
  /** Pick choices: the texts a thing asks for when picked (`textInputs`), by thing. */
  textInputs?: ReadonlyMap<string, readonly TextInput[]>;
}

export interface Judgement {
  /** `incomplete`: fits, but more is needed (fewer picks than asked). */
  status: "answered" | "incomplete" | "invalid";
  problem?: Problem;
  /** How many picks are still open, or points left unspent. */
  remaining?: number;
  /** Picks that count for the character (pick choices). */
  counted?: string[];
  /** Base values the answer sets (distribute and number choices). */
  inputs?: Record<string, number>;
  /** Points the answer adds to values (distribute with `raise`). */
  raises?: Record<string, number>;
  /** Pick choices: counted picks whose needed texts are still empty, in pick order. */
  textsMissing?: string[];
}

const invalid = (problem: Problem, extra: Partial<Judgement> = {}): Judgement => ({
  status: "invalid",
  problem,
  ...extra,
});

// Control characters other than tab and line breaks never belong in a name or a description.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function judgeAnswer(choice: Choice, raw: unknown, ctx: ChoiceContext): Judgement {
  const schema = answerSchemaFor(choice.kind);
  if (!schema) return invalid("badShape");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return invalid("badShape");
  const answer: Answer = parsed.data;

  switch (choice.kind) {
    case "pickOne": {
      const { pick, texts } = answer as { pick: string; texts?: PickTexts };
      if (!(ctx.options ?? []).includes(pick)) return invalid("notOffered", { counted: [] });
      return judgeTexts({ status: "answered", counted: [pick] }, texts, ctx);
    }
    case "pickMany": {
      const { picks } = answer as { picks: string[] };
      const count = ctx.count ?? 0;
      const offered = new Set(ctx.options ?? []);
      const valid = [...new Set(picks)].filter((p) => offered.has(p));
      const counted = valid.slice(0, count);
      if (new Set(picks).size !== picks.length) return invalid("duplicate", { counted });
      if (valid.length !== picks.length) return invalid("notOffered", { counted });
      if (picks.length > count) return invalid("tooMany", { counted });
      const { texts } = answer as { texts?: PickTexts };
      if (picks.length === count || choice.upTo)
        return judgeTexts({ status: "answered", counted }, texts, ctx);
      return judgeTexts({ status: "incomplete", counted, remaining: count - picks.length }, texts, ctx);
    }
    case "distribute":
      return judgeDistribute(choice, answer as DistributeAnswer, ctx);
    case "number": {
      const { value } = answer as { value: number };
      if (value < (ctx.min ?? -Infinity) || value > (ctx.max ?? Infinity)) return invalid("outOfRange");
      return { status: "answered", inputs: { [choice.target]: value } };
    }
    case "text": {
      const text = (answer as { text: string }).text.trim();
      if (text.length === 0) return invalid("empty");
      if ([...text].length > choice.maxLength) return invalid("tooLong");
      if (CONTROL.test(text) || (!choice.multiline && /[\r\n]/.test(text))) return invalid("badCharacters");
      return { status: "answered" };
    }
    case "info":
      return invalid("badShape");
  }
}

/** The texts of a counted pick (`textInputs`): too long or odd characters do not fit; a needed one left empty is not done yet. */
function judgeTexts(j: Judgement, texts: PickTexts | undefined, ctx: ChoiceContext): Judgement {
  const missing: string[] = [];
  const counted = j.counted ?? [];
  for (const thing of counted) {
    for (const input of ctx.textInputs?.get(thing) ?? []) {
      const text = (texts?.[thing]?.[input.id] ?? "").trim();
      if ([...text].length > input.maxLength) return invalid("tooLong", { counted });
      if (CONTROL.test(text) || /[\r\n]/.test(text)) return invalid("badCharacters", { counted });
      if (text.length === 0 && !input.optional && !missing.includes(thing)) missing.push(thing);
    }
  }
  if (missing.length === 0) return j;
  return { ...j, status: "incomplete", textsMissing: missing, remaining: j.remaining ?? 0 };
}

function judgeDistribute(
  choice: Extract<Choice, { kind: "distribute" }>,
  answer: DistributeAnswer,
  ctx: ChoiceContext,
): Judgement {
  const method = choice.methods[answer.method];
  if (!method) return invalid("badMethod");
  if (method.method === "raise") {
    // Only the targets that get points need to be named.
    const per = method.maxPerTarget ?? method.points;
    const most = (t: string) => ctx.raise?.most[t] ?? per;
    const entries = Object.entries(answer.assign);
    if (entries.some(([t, n]) => !choice.targets.includes(t) || n < 0)) return invalid("badAssignment");
    if (entries.some(([t, n]) => n > most(t))) return invalid("outOfRange");
    const spent = entries.reduce((sum, [, n]) => sum + n, 0);
    if (spent > method.points) return invalid("overBudget");
    const raises = Object.fromEntries(entries.filter(([, n]) => n > 0));
    // Fewer points are enough only when no target can take another one.
    const room = choice.targets.some((t) => (answer.assign[t] ?? 0) < most(t));
    if (spent < method.points && room)
      return { status: "incomplete", raises, remaining: method.points - spent };
    return { status: "answered", raises };
  }
  const keys = Object.keys(answer.assign);
  if (keys.length !== choice.targets.length || !choice.targets.every((t) => t in answer.assign)) {
    return invalid("badAssignment");
  }
  const inputs = { ...answer.assign };
  if (method.method === "array") {
    const given = choice.targets.map((t) => answer.assign[t]!).sort((a, b) => a - b);
    const wanted = [...method.values].sort((a, b) => a - b);
    if (given.length !== wanted.length || given.some((v, i) => v !== wanted[i])) {
      return invalid("badAssignment");
    }
    return { status: "answered", inputs };
  }
  // Point buy: `costs` is the total cost of reaching a score.
  let spent = 0;
  for (const t of choice.targets) {
    const cost = method.costs[String(answer.assign[t])];
    if (cost === undefined) return invalid("outOfRange");
    spent += cost;
  }
  if (spent > method.budget) return invalid("overBudget");
  // Points may be left over; the package's own recommendations can do that too.
  return { status: "answered", inputs, remaining: method.budget - spent };
}
