/**
 * Level headings in the step list. The steps of a group stand in the order
 * the package grants them, so a choice of the first level can follow one
 * that comes at a higher level; the headings and the span still say the
 * level each one comes at.
 */

/**
 * The heading before a step that comes at `at` after one at `prev`: "from"
 * a higher level, "at" the first level when it follows a higher one, none
 * while the level stays the same or the list starts at the first level.
 */
export function levelHeading(prev: number, at: number, min: number): "from" | "at" | undefined {
  if (at === prev) return undefined;
  if (at > min) return "from";
  return prev > min ? "at" : undefined;
}

/** The lowest and highest level of a group's steps, or undefined when they share one. */
export function levelSpan(levels: number[]): { from: number; to: number } | undefined {
  if (levels.length === 0) return undefined;
  const from = Math.min(...levels);
  const to = Math.max(...levels);
  return from === to ? undefined : { from, to };
}
