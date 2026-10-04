/**
 * Quantities and texts for display, the same on server and in the browser.
 *
 * Amounts live in the package in their source unit. Which unit a reader
 * sees is an account setting per dimension, independent of the language;
 * without a setting the package's default for the language applies.
 * Conversion follows the package's table (SPEC 12), never plain math.
 */
import {
  convertAmount,
  dimensionOf,
  parseTemplate,
  type Quantity,
  type TextValue,
  type Units,
} from "@builder/format/pure";

export interface MeasureContext {
  /** units.json of the package. */
  units: Units;
  /** Texts of the package in the reader's language. */
  texts: Readonly<Record<string, TextValue>>;
  language: string;
  /** The reader's unit per dimension, from the account settings. Missing dimensions use the language default. */
  preferred?: Readonly<Record<string, string>>;
}

/** The unit per dimension a reader sees: their choice if the package offers it, else the language default. */
export function effectiveUnits(
  units: Units,
  language: string,
  preferred: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const defaults = units.languageDefaults[language] ?? {};
  const result: Record<string, string> = {};
  for (const [dim, d] of Object.entries(units.dimensions)) {
    const wanted = preferred[dim];
    result[dim] = wanted !== undefined && d.units.includes(wanted) ? wanted : (defaults[dim] ?? d.source);
  }
  return result;
}

/** Converts a quantity to the reader's unit. Keeps the source unit if the package has no way to convert. */
export function convertMeasure(ctx: MeasureContext, q: Quantity): Quantity {
  const dim = dimensionOf(ctx.units, q.unit);
  if (dim === undefined) return q;
  const target = effectiveUnits(ctx.units, ctx.language, ctx.preferred)[dim] ?? q.unit;
  const amount = convertAmount(ctx.units, q.amount, q.unit, target);
  return amount === undefined ? q : { amount, unit: target };
}

/**
 * "9 m", "9 meters", "1,5 m": a quantity converted and written for the reader.
 * `short` is for sheets and cards, `long` for running text.
 */
export function formatMeasure(ctx: MeasureContext, q: Quantity, form: "short" | "long" = "long"): string {
  const shown = convertMeasure(ctx, q);
  const number = new Intl.NumberFormat(ctx.language, { maximumFractionDigits: 2 }).format(shown.amount);
  return `${number} ${unitWord(ctx.texts, shown.unit, shown.amount, form)}`;
}

function unitWord(
  texts: Readonly<Record<string, TextValue>>,
  unit: string,
  amount: number,
  form: "short" | "long",
): string {
  const pick = (key: string) => {
    const t = texts[key];
    return typeof t === "string" ? t : undefined;
  };
  if (form === "short") return pick(`unit.${unit}.short`) ?? unit;
  return (
    (amount === 1 ? pick(`unit.${unit}.longOne`) : undefined) ??
    pick(`unit.${unit}.long`) ??
    pick(`unit.${unit}.short`) ??
    unit
  );
}

export type TextPart = { type: "text"; text: string } | { type: "glossary"; id: string; text: string };

/**
 * Fills the placeholders of a package text (SPEC 10.4): quantities are
 * converted and formatted, `{{var:x}}` takes `vars.x`. Glossary links stay
 * separate parts so the screen can make them clickable.
 */
export function renderText(
  ctx: MeasureContext,
  template: string,
  vars: Readonly<Record<string, string | number>> = {},
): TextPart[] {
  const out: TextPart[] = [];
  const push = (text: string) => {
    const last = out.at(-1);
    if (last?.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  for (const part of parseTemplate(template)) {
    switch (part.type) {
      case "text":
        push(part.text);
        break;
      case "var": {
        const v = vars[part.name];
        push(
          v === undefined ? "" : typeof v === "number" ? new Intl.NumberFormat(ctx.language).format(v) : v,
        );
        break;
      }
      case "quantity": {
        const source = ctx.units.dimensions[part.dimension]?.source;
        push(
          source === undefined
            ? String(part.amount)
            : formatMeasure(ctx, { amount: part.amount, unit: source }, part.form),
        );
        break;
      }
      case "glossary":
        out.push({ type: "glossary", id: part.id, text: part.text });
        break;
    }
  }
  return out;
}
