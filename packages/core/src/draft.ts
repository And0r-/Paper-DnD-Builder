/**
 * The character draft document and the answers it holds.
 *
 * A draft is deliberately small: the chosen level and the raw answer to
 * each choice, by choice key. Everything else (which steps are asked, what
 * the character has, every number) is derived by `evaluateDraft` from the
 * package. Answers that stop fitting after an earlier change stay in the
 * document so going back restores them.
 */
import { z } from "zod";
import type { Choice } from "@builder/format/pure";

export const pickOneAnswerSchema = z.strictObject({ pick: z.string().min(1).max(200) });
export const pickManyAnswerSchema = z.strictObject({ picks: z.array(z.string().min(1).max(200)).max(200) });
export const distributeAnswerSchema = z.strictObject({
  /** Index into the choice's `methods`. */
  method: z.number().int().min(0),
  assign: z.record(z.string().max(100), z.number().int()),
});
export const numberAnswerSchema = z.strictObject({ value: z.number().finite() });
export const textAnswerSchema = z.strictObject({ text: z.string().max(10_000) });

export type PickOneAnswer = z.infer<typeof pickOneAnswerSchema>;
export type PickManyAnswer = z.infer<typeof pickManyAnswerSchema>;
export type DistributeAnswer = z.infer<typeof distributeAnswerSchema>;
export type NumberAnswer = z.infer<typeof numberAnswerSchema>;
export type TextAnswer = z.infer<typeof textAnswerSchema>;
export type Answer = PickOneAnswer | PickManyAnswer | DistributeAnswer | NumberAnswer | TextAnswer;

/** Answer shape expected for a choice kind; `info` choices take no answer. */
export function answerSchemaFor(kind: Choice["kind"]): z.ZodType<Answer> | undefined {
  switch (kind) {
    case "pickOne":
      return pickOneAnswerSchema;
    case "pickMany":
      return pickManyAnswerSchema;
    case "distribute":
      return distributeAnswerSchema;
    case "number":
      return numberAnswerSchema;
    case "text":
      return textAnswerSchema;
    case "info":
      return undefined;
  }
}

export const draftDocumentSchema = z.strictObject({
  level: z.number().int().min(1),
  levelBefore: z.number().int().min(1).optional(),
  answers: z.record(z.string(), z.unknown()),
});

export interface DraftDocument {
  level: number;
  /**
   * Set while a finished character is being raised: the level it was
   * finished at. Steps with `atLevel` above it are the ones the raise added.
   * Cleared when the character is finished again.
   */
  levelBefore?: number;
  /** Raw answers by choice key. Shapes are checked against the package on use. */
  answers: Record<string, unknown>;
}

/** One edit of a draft. Every change to a draft goes through one of these. */
export type DraftChange =
  | { type: "setLevel"; level: number }
  /** `answer: null` removes the answer. */
  | { type: "answer"; choice: string; answer: unknown }
  /**
   * All picks of a list step (`together: "list"`). The core assigns each pick
   * to one of the step's choices and stores one answer per choice.
   */
  | { type: "pool"; step: string; picks: string[] };
