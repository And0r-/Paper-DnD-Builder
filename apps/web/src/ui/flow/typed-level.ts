/**
 * A level typed into the number field, read on every key (AND-89): the
 * button, the hint and the top bar follow the field at once, as they do for
 * the − and + buttons, not only when the field is left.
 */
export interface TypedLevel {
  /** The level the text stands for: a whole number from min to max. */
  level?: number;
  /** No further digit could still give a level up to max ("1" may become "12", "5" may not under 20). */
  complete: boolean;
  /** Not a level and no start of one (empty is not wrong yet, only unfinished). */
  invalid: boolean;
}

export function typedLevel(text: string, min: number, max: number): TypedLevel {
  const s = text.trim();
  if (s === "") return { complete: false, invalid: false };
  const n = Number(s);
  if (!Number.isInteger(n)) return { complete: false, invalid: true };
  const grows = n > 0 && n * 10 <= max;
  if (n >= min && n <= max) return { level: n, complete: !grows, invalid: false };
  return { complete: false, invalid: !grows };
}
