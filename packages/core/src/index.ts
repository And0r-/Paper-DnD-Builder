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
export { answersFromExtension } from "./extensions.ts";
export { judgeAnswer, type Problem } from "./judge.ts";
export {
  byLevel,
  byValue,
  evaluateDraft,
  evaluationScope,
  filledTextKey,
  fillRaise,
  grantAppliesFrom,
  grantTableLevel,
  selectThings,
  trackThings,
  type ChoiceState,
  type ChoiceStatus,
  type Evaluation,
  type HeldThing,
  type InfoContent,
  type PoolState,
  type RaiseState,
  type StepState,
  type TrackOption,
  type TracksState,
} from "./evaluate.ts";
export { dependentValues } from "./depends.ts";
export { fillPicks, type PoolSlot } from "./pool.ts";
export { explainValue, totalOf, type PartSource, type ValueExplanation, type ValuePart } from "./explain.ts";
export {
  applyChange,
  headTracks,
  levelUp,
  levelUpState,
  newDraft,
  summarize,
  tracksText,
  type ChangeError,
  type ChangeResult,
  type DraftSummary,
  type LevelUpState,
  type TrackLevels,
} from "./change.ts";
export {
  convertMeasure,
  effectiveUnits,
  formatMeasure,
  renderText,
  type MeasureContext,
  type TextPart,
} from "./measure.ts";
