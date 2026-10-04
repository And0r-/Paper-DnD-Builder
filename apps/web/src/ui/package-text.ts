/**
 * Reading package texts. Keys follow SPEC 10.2. A missing text (null or
 * absent) stays missing: it is never filled from another language.
 */
import {
  formatMeasure,
  renderText,
  type ChoiceState,
  type Evaluation,
  type MeasureContext,
  type TextPart,
} from "@builder/core";
import type { Choice } from "@builder/format/pure";
import type { LoadedPackage } from "./packages.ts";

export function ptext(lp: LoadedPackage, key: string): string | undefined {
  const v = lp.texts[key];
  return typeof v === "string" ? v : undefined;
}

export function plist(lp: LoadedPackage, key: string): string[] {
  const v = lp.texts[key];
  return Array.isArray(v) ? v : [];
}

export function measureContext(
  lp: LoadedPackage,
  preferred: Record<string, string> | undefined,
): MeasureContext {
  return { units: lp.pkg.units, texts: lp.texts, language: lp.lang, ...(preferred ? { preferred } : {}) };
}

/** Plain string of a template: placeholders filled, glossary links as their words. */
export function plain(
  ctx: MeasureContext,
  template: string | undefined,
  vars?: Record<string, string | number>,
) {
  if (template === undefined) return "";
  return renderText(ctx, template, vars)
    .map((p: TextPart) => p.text)
    .join("");
}

export function thingName(lp: LoadedPackage, id: string): string {
  return ptext(lp, `${id}.name`) ?? "";
}

export function choiceOf(lp: LoadedPackage, id: string): Choice | undefined {
  return lp.pkg.flow.choices.find((c) => c.id === id);
}

export interface StepTexts {
  title: string;
  question: string;
  /** Template; show it with `RichText` and `vars`. */
  intro: string | undefined;
  /** Variables for the intro (SPEC 10.4), already filled into title and question. */
  vars: Record<string, number>;
}

export type ChoiceTexts = StepTexts & {
  /** Template; the caller adds `remaining` to `vars`. */
  missing: string | undefined;
};

type TextField = "title" | "question" | "intro" | "missing";

/** A choice text: the active variant's if the package has it, else the base text (SPEC 9.3). */
function choiceText(
  lp: LoadedPackage,
  choiceId: string,
  field: TextField,
  state: ChoiceState | undefined,
): string | undefined {
  const variant = state?.textVariant;
  return (
    (variant !== undefined ? ptext(lp, `choice.${choiceId}.variant.${variant}.${field}`) : undefined) ??
    ptext(lp, `choice.${choiceId}.${field}`)
  );
}

/**
 * The texts of a choice for this character. `state` (from the evaluation)
 * picks the text variant and supplies `count` of a pickMany choice; without
 * it the base texts show. `ctx` sets the units of any quantity in a title.
 */
export function choiceTexts(
  lp: LoadedPackage,
  choiceId: string,
  state?: ChoiceState,
  ctx: MeasureContext = measureContext(lp, undefined),
): ChoiceTexts {
  const vars: Record<string, number> =
    state?.kind === "pickMany" && state.count !== undefined ? { count: state.count } : {};
  return {
    title: plain(ctx, choiceText(lp, choiceId, "title", state), vars),
    question: plain(ctx, choiceText(lp, choiceId, "question", state), vars),
    intro: choiceText(lp, choiceId, "intro", state),
    missing: choiceText(lp, choiceId, "missing", state),
    vars,
  };
}

/**
 * A step with one choice uses the choice's texts; a combined step (several
 * choices, or a gather step showing them together) has its own. `ev` lets a
 * single choice use its text variant and count.
 */
export function stepTexts(
  lp: LoadedPackage,
  step: { id: string; choices?: string[]; gather?: unknown },
  ev?: Evaluation,
  ctx: MeasureContext = measureContext(lp, undefined),
): StepTexts {
  if (step.gather === undefined && step.choices?.length === 1) {
    const id = step.choices[0]!;
    const { missing: _, ...texts } = choiceTexts(lp, id, ev?.choices[id], ctx);
    return texts;
  }
  const prefix = `step.${step.id}`;
  return {
    title: plain(ctx, ptext(lp, `${prefix}.title`)),
    question: plain(ctx, ptext(lp, `${prefix}.question`)),
    intro: ptext(lp, `${prefix}.intro`),
    vars: {},
  };
}

/** A value or a change of it, in the reader's units if the value is a quantity ("+7,5 m"). */
export function formatValue(
  lp: LoadedPackage,
  ctx: MeasureContext,
  valueId: string,
  n: number,
  signed = false,
): string {
  const unit = lp.pkg.values.find((v) => v.id === valueId)?.unit;
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const body = unit
    ? formatMeasure(ctx, { amount: abs, unit }, "short")
    : new Intl.NumberFormat(lp.lang).format(abs);
  return sign + body;
}

/**
 * A value that is only "has it or not": no unit, no formula, from 0 to 1
 * (for example "trained in X"). Showing "+1" for it reads like a number
 * the player has to understand; the name alone says it.
 */
export function isYesNoValue(lp: LoadedPackage, valueId: string): boolean {
  const v = lp.pkg.values.find((x) => x.id === valueId);
  return !!v && !v.unit && !v.formula && v.max === 1 && (v.min ?? 0) === 0 && (v.default ?? 0) === 0;
}

/** One gained value for "What you get": "Stamina +15", or just the name for a yes/no value. */
export function grantedValue(lp: LoadedPackage, ctx: MeasureContext, valueId: string, add: number): string {
  const name = ptext(lp, `value.${valueId}.name`) ?? valueId;
  if (isYesNoValue(lp, valueId) && add > 0) return name;
  return `${name} ${formatValue(lp, ctx, valueId, add, true)}`;
}

/**
 * Names of the ways to distribute (dist.method). With one fixed row of
 * numbers it is "Assign fixed numbers"; with several, each row is named by
 * its numbers ("2 and 1", "1, 1 and 1") so no two buttons read the same.
 * Zeros are left out: giving 0 is giving nothing.
 */
export function distributeMethodLabels(
  methods: readonly ({ method: "pointBuy" } | { method: "array"; values: number[] })[],
  lang: string,
  t: (key: "dist.pointBuy" | "dist.array" | "dist.arrayOf", vars?: Record<string, string>) => string,
  list: (items: readonly string[]) => string,
): string[] {
  const arrays = methods.filter((m) => m.method === "array").length;
  const nf = new Intl.NumberFormat(lang);
  return methods.map((m) => {
    if (m.method === "pointBuy") return t("dist.pointBuy");
    if (arrays < 2) return t("dist.array");
    const shown = m.values.filter((n) => n !== 0);
    return t("dist.arrayOf", {
      values: list((shown.length > 0 ? shown : m.values).map((n) => nf.format(n))),
    });
  });
}
