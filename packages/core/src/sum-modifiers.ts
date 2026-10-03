/**
 * Adds up numeric modifiers keyed by an opaque source id.
 *
 * Placeholder example of the core's style: pure, data-in/data-out, no
 * knowledge of what the numbers mean.
 */
export function sumModifiers(modifiers: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const value of Object.values(modifiers)) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Modifier must be a finite number, got ${String(value)}`);
    }
    total += value;
  }
  return total;
}
