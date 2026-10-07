/**
 * Turns the API's ids into what a model can talk about: every id comes
 * with its name from the package texts. Ids stay in the answer, because
 * the next tool call needs them.
 */
import type { ChangeResult } from "../api-client.ts";
import type { ChoiceState, DraftView, Evaluation, FlowChoice } from "../api-types.ts";
import type { Words } from "../words.ts";

export function choiceTitle(words: Words, c: ChoiceState): string {
  return words.choice(c, "title") ?? words.choice(c, "question") ?? c.id;
}

export function evaluationOf(view: DraftView): Evaluation {
  if (!view.evaluation) {
    throw new PackageMissing(view.draft.packageId);
  }
  return view.evaluation;
}

/** Thrown when the builder has not loaded the package of a character; turned into an error result. */
export class PackageMissing extends Error {
  constructor(packageId: string) {
    super(
      `The package "${packageId}" this character was built with is not loaded on the builder right now, ` +
        "so its choices and values cannot be worked out.",
    );
  }
}

/** The open choices, in the order the builder asks them. */
export function openChoices(ev: Evaluation, words: Words) {
  return ev.open.flatMap((id) => {
    const c = ev.choices[id];
    return c ? [{ choice: id, title: choiceTitle(words, c) }] : [];
  });
}

/** Where a character stands after reading or changing it. */
export function standing(view: DraftView, words: Words) {
  const ev = evaluationOf(view);
  return {
    characterId: view.draft.id,
    name: view.summary?.name ?? null,
    level: view.draft.level,
    state: view.draft.status === "finished" ? "finished" : "open",
    ...(view.draft.levelBefore !== null ? { raisingFrom: view.draft.levelBefore } : {}),
    canFinish: ev.complete && view.draft.status !== "finished",
    openChoices: openChoices(ev, words),
  };
}

/** The data of a change: the new standing, or what moved on if the change was not made. */
export function changeOutcome(result: ChangeResult, words: Words) {
  if (result.applied) return { done: true, ...standing(result.view, words) };
  const ev = result.view.evaluation;
  const { level, status, answers } = result.changedElsewhere;
  return {
    done: false,
    message:
      "The character was changed somewhere else (another window or program) since it was last read, so " +
      "this change was NOT made. Here is what changed; look at the character again and decide anew.",
    changedElsewhere: {
      ...(level ? { level } : {}),
      ...(status ? { state: status } : {}),
      answers: answers.map((id) => {
        const c = ev?.choices[id];
        return { choice: id, title: c ? choiceTitle(words, c) : id };
      }),
    },
    now: standing(result.view, words),
  };
}

/** A stored answer in words: picks by name, points per value by name. */
export function answerInWords(words: Words, answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null) return answer;
  const a = answer as Record<string, unknown>;
  if (typeof a["pick"] === "string") return words.name(a["pick"]);
  if (Array.isArray(a["picks"])) return a["picks"].map((p) => words.name(String(p)));
  if (typeof a["assign"] === "object" && a["assign"] !== null) {
    return Object.fromEntries(
      Object.entries(a["assign"] as Record<string, number>).map(([v, n]) => [words.value(v), n]),
    );
  }
  if ("value" in a) return a["value"];
  if ("text" in a) return a["text"];
  return answer;
}

/** A points method of a `distribute` choice, in words. */
export function methodInWords(m: Record<string, unknown> & { method: string }, index: number) {
  switch (m.method) {
    case "pointBuy":
      return {
        method: index,
        how: "Buy each value with points: the table says what each number costs; spend at most the budget.",
        budget: m["budget"],
        costs: m["costs"],
      };
    case "array":
      return {
        method: index,
        how: "Give each of these numbers to exactly one value.",
        numbers: m["values"],
      };
    case "raise":
      return {
        method: index,
        how:
          "Add points on top of the values as they are now; assign names only the values that get points. " +
          "See raise for the points and the most each value can take.",
        points: m["points"],
        ...(m["maxPerTarget"] !== undefined ? { mostPerValue: m["maxPerTarget"] } : {}),
      };
    default:
      return { method: index, kind: m.method };
  }
}

export function flowChoice(choices: FlowChoice[], c: ChoiceState): FlowChoice | undefined {
  const id = c.copyOf ?? c.id;
  return choices.find((f) => f.id === id);
}
