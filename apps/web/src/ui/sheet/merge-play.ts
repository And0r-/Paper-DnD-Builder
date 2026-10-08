import type { PlayValue } from "@builder/sheet";

export type PlayState = Record<string, PlayValue>;

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The stored play state `theirs` with what this window changed since `base`
 * on top; a field both changed keeps the stored value (the last one saved).
 */
export function mergePlay(base: PlayState, mine: PlayState, theirs: PlayState): PlayState {
  const out = { ...theirs };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (same(mine[k], base[k]) || !same(theirs[k], base[k])) continue;
    if (mine[k] === undefined) delete out[k];
    else out[k] = mine[k]!;
  }
  return out;
}
