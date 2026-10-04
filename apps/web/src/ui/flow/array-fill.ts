/**
 * Giving out a fixed row of numbers by tapping (flow spec 3, distribute).
 * Pure, so it is tested without a browser.
 */

/** Taps plus the lowest number on every open row once nothing higher is left. */
export function fillArray(
  targets: string[],
  values: number[],
  taps: Record<string, number>,
): { assign: Record<string, number | undefined>; free: number[]; implicit: string[] } {
  const free = [...values].sort((a, b) => b - a);
  const assign: Record<string, number | undefined> = {};
  for (const v of targets) {
    const n = taps[v];
    const i = n === undefined ? -1 : free.indexOf(n);
    if (i < 0) continue;
    free.splice(i, 1);
    assign[v] = n;
  }
  const lowest = Math.min(...values);
  const open = targets.filter((v) => assign[v] === undefined);
  const implicit = free.length === open.length && free.every((n) => n === lowest) ? open : [];
  for (const v of implicit) assign[v] = lowest;
  return { assign, free: implicit.length > 0 ? [] : free, implicit };
}

/** The answer a row of numbers forces: every number the same, nothing to tap. */
export function forcedArray(targets: string[], values: number[]): Record<string, number> | undefined {
  const { assign, implicit } = fillArray(targets, values, {});
  return implicit.length === targets.length ? (assign as Record<string, number>) : undefined;
}

/** The row of numbers from high to low, each marked as still free or given out. */
export function freeMarks(values: number[], free: number[]): { n: number; used: boolean }[] {
  const left = [...free];
  return [...values]
    .sort((a, b) => b - a)
    .map((n) => {
      const i = left.indexOf(n);
      if (i >= 0) left.splice(i, 1);
      return { n, used: i < 0 };
    });
}
