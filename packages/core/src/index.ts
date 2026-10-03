/**
 * Rule core.
 *
 * The core evaluates formulas and dependencies that content packages declare.
 * It must never contain knowledge of a specific rule system: every rule,
 * value and label comes from a loaded package.
 *
 * This module is a skeleton. Evaluation lands in a follow-up task.
 */

/** Version of the core's public API. Bumped on breaking changes. */
export const CORE_API_VERSION = 0;

export { sumModifiers } from "./sum-modifiers.ts";
