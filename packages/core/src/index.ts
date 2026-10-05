/**
 * Rule core.
 *
 * The core evaluates what a content package declares: steps, choices,
 * conditions, formulas and unit tables. It must never contain knowledge of
 * a specific rule system: every rule, value and label comes from a loaded
 * package. It runs on the server and in the browser (no Node-only APIs).
 */

/** Version of the core's public API. Bumped on breaking changes. */
export const CORE_API_VERSION = 1;

export {
  answerSchemaFor,
  draftDocumentSchema,
  type Answer,
  type DraftChange,
  type DraftDocument,
  type DistributeAnswer,
  type NumberAnswer,
  type PickManyAnswer,
  type PickOneAnswer,
  type TextAnswer,
} from "./draft.ts";
export { evaluate, evaluateCondition, evaluateNumber, RuleError, type ExprScope } from "./expr.ts";
export { judgeAnswer, type Problem } from "./judge.ts";
export {
  byLevel,
  evaluateDraft,
  evaluationScope,
  fillRaise,
  selectThings,
  type ChoiceState,
  type ChoiceStatus,
  type Evaluation,
  type HeldThing,
  type InfoContent,
  type PoolState,
  type RaiseState,
  type StepState,
} from "./evaluate.ts";
export { explainValue, totalOf, type PartSource, type ValueExplanation, type ValuePart } from "./explain.ts";
export {
  applyChange,
  levelUp,
  levelUpState,
  newDraft,
  summarize,
  type ChangeError,
  type ChangeResult,
  type DraftSummary,
  type LevelUpState,
} from "./change.ts";
export {
  convertMeasure,
  effectiveUnits,
  formatMeasure,
  renderText,
  type MeasureContext,
  type TextPart,
} from "./measure.ts";
