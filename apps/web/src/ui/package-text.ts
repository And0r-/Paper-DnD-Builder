/**
 * Reading package texts. Keys follow SPEC 10.2. A missing text (null or
 * absent) stays missing: it is never filled from another language.
 */
import { formatMeasure, renderText, type MeasureContext, type TextPart } from "@builder/core";
import type { Choice, Step } from "@builder/format/pure";
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
  intro: string | undefined;
}

/** A step with one choice uses the choice's texts; a combined step has its own. */
export function stepTexts(lp: LoadedPackage, step: Pick<Step, "id" | "choices">): StepTexts {
  const prefix = step.choices.length === 1 ? `choice.${step.choices[0]}` : `step.${step.id}`;
  return {
    title: ptext(lp, `${prefix}.title`) ?? "",
    question: ptext(lp, `${prefix}.question`) ?? "",
    intro: ptext(lp, `${prefix}.intro`),
  };
}

export function choiceTexts(
  lp: LoadedPackage,
  choiceId: string,
): StepTexts & { missing: string | undefined } {
  return {
    title: ptext(lp, `choice.${choiceId}.title`) ?? "",
    question: ptext(lp, `choice.${choiceId}.question`) ?? "",
    intro: ptext(lp, `choice.${choiceId}.intro`),
    missing: ptext(lp, `choice.${choiceId}.missing`),
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
