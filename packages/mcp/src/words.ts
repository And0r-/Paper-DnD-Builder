/**
 * Package texts in one language, written out for a reader: placeholders
 * filled (SPEC 10.4), quantities converted by the package's table into the
 * account's units, glossary links reduced to their words. Every name a
 * tool shows comes from here; nothing is filled from another language.
 */
import { convertAmount, parseTemplate, type Units } from "@builder/format/pure";
import type { ChoiceState, TextInput, TextValue, TrackLevels } from "./api-types.ts";

export interface WordsContext {
  texts: Readonly<Record<string, TextValue>>;
  units: Units;
  language: string;
  /** The account's unit per dimension; a missing one follows the language. */
  preferred: Readonly<Record<string, string>>;
  /** The texts a pick of a thing asks for, by thing. */
  textInputs?: ReadonlyMap<string, readonly TextInput[]>;
}

type Vars = Readonly<Record<string, string | number>>;

export class Words {
  readonly language: string;
  private readonly ctx: WordsContext;

  constructor(ctx: WordsContext) {
    this.ctx = ctx;
    this.language = ctx.language;
  }

  /** A text written out, or null if the package has none under this key. */
  text(key: string, vars: Vars = {}): string | null {
    const t = this.ctx.texts[key];
    if (typeof t !== "string") return null;
    try {
      return this.render(t, vars);
    } catch {
      return t;
    }
  }

  /** The name of a thing, value or anything with `<key>.name`; the key itself if there is none. */
  name(key: string): string {
    return this.text(`${key}.name`) ?? key;
  }

  value(id: string): string {
    return this.name(`value.${id}`);
  }

  /** Texts of a choice, honouring copies (`copyOf`) and text variants. */
  choice(c: Pick<ChoiceState, "id" | "copyOf" | "textVariant" | "count" | "remaining">, field: string) {
    const id = c.copyOf ?? c.id;
    const vars: Record<string, number> = {};
    if (c.count !== undefined) vars["count"] = c.count;
    if (c.remaining !== undefined) vars["remaining"] = c.remaining;
    return (
      (c.textVariant ? this.text(`choice.${id}.variant.${c.textVariant}.${field}`, vars) : null) ??
      this.text(`choice.${id}.${field}`, vars)
    );
  }

  step(id: string, field: string): string | null {
    return this.text(`step.${id}.${field}`);
  }

  /** The texts a pick of a thing asks for, each with its label; empty if it asks for none. */
  textInputs(key: string) {
    return (this.ctx.textInputs?.get(key) ?? []).map((i) => ({
      input: i.id,
      label: this.text(`${key}.input.${i.id}.label`) ?? i.id,
      maxLength: i.maxLength,
      ...(i.optional ? { optional: true } : {}),
    }));
  }

  /** "Name, short, what it is, what you do with it, who it suits" of a thing. */
  thing(key: string) {
    return {
      name: this.name(key),
      short: this.text(`${key}.short`),
      what: this.text(`${key}.explain.what`),
      atTheTable: this.text(`${key}.explain.table`),
      goodIf: this.text(`${key}.goodIf`),
    };
  }

  /**
   * The character list's one-line summary: thing keys become names. Null
   * while something it names is not chosen yet, as in the web app.
   */
  summaryLine(
    line: Readonly<Record<string, string | number | readonly TrackLevels[] | null>>,
  ): string | null {
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(line)) {
      if (v === null) return null;
      vars[k] = typeof v === "number" ? v : typeof v === "string" ? this.name(v) : this.tracks(v);
    }
    return this.text("summary.line", vars);
  }

  /** Tracks with their levels, "A 3 / B 2"; one track alone is just its name. */
  tracks(list: readonly TrackLevels[]): string {
    if (list.length === 1) return this.name(list[0]!.thing);
    return list.map((t) => `${this.name(t.thing)} ${this.number(t.levels)}`).join(" / ");
  }

  /** How the package writes a value ("d8" for a die), if it says; else the number. */
  amount(valueId: string, n: number): string {
    return this.text(`value.${valueId}.amount`, { n }) ?? this.number(n);
  }

  number(n: number, signed = false): string {
    return new Intl.NumberFormat(this.language, {
      maximumFractionDigits: 2,
      ...(signed ? { signDisplay: "always" as const } : {}),
    }).format(n);
  }

  private render(template: string, vars: Vars): string {
    let out = "";
    for (const part of parseTemplate(template)) {
      switch (part.type) {
        case "text":
          out += part.text;
          break;
        case "glossary":
          out += part.text;
          break;
        case "var": {
          const v = vars[part.name];
          out += v === undefined ? "" : typeof v === "number" ? this.number(v, part.signed) : v;
          break;
        }
        case "quantity":
          out += this.quantity(part.dimension, part.amount, part.form);
          break;
      }
    }
    return out;
  }

  /** An amount in the dimension's source unit, converted by the package's table for this reader. */
  private quantity(dimension: string, amount: number, form: "short" | "long"): string {
    const { units, language, preferred } = this.ctx;
    const dim = units.dimensions[dimension];
    if (!dim) return String(amount);
    const wanted = preferred[dimension];
    const target =
      wanted !== undefined && dim.units.includes(wanted)
        ? wanted
        : (units.languageDefaults[language]?.[dimension] ?? dim.source);
    const converted = convertAmount(units, amount, dim.source, target);
    const [shown, unit] = converted === undefined ? [amount, dim.source] : [converted, target];
    return `${this.number(shown)} ${this.unitWord(unit, shown, form)}`;
  }

  private unitWord(unit: string, amount: number, form: "short" | "long"): string {
    const pick = (key: string) => {
      const t = this.ctx.texts[key];
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
}
