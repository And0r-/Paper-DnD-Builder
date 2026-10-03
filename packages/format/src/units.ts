import type { Units } from "./schema.ts";

/**
 * Converts an amount for display, following the package's conversion table.
 *
 * Table rows win. Only amounts missing from the table use the package's
 * optional fallback (amount * factor, rounded to the nearest step). Returns
 * undefined if the package declares no way to convert this amount; a valid
 * package never lets that happen for amounts it states itself.
 */
export function convertAmount(units: Units, amount: number, from: string, to: string): number | undefined {
  if (from === to) return amount;
  const conversion = units.conversions.find((c) => c.from === from && c.to === to);
  if (!conversion) return undefined;
  const row = conversion.table.find(([a]) => a === amount);
  if (row) return row[1];
  if (!conversion.fallback) return undefined;
  const { factor, step } = conversion.fallback;
  // toPrecision strips float noise such as 7.499999999 from the rounding.
  return Number((Math.round((amount * factor) / step) * step).toPrecision(12));
}

/** The dimension a unit belongs to, or undefined. */
export function dimensionOf(units: Units, unit: string): string | undefined {
  return Object.entries(units.dimensions).find(([, d]) => d.units.includes(unit))?.[0];
}
