/**
 * Where numbers and things come from, in words: "7 + 1 from Ferry Child
 * (Upbringing) = 8", "from Folk Moorfolk". A player who sees a number change, or
 * a thing on the sheet they never picked, can see why.
 */
import {
  explainValue,
  totalOf,
  type ChoiceState,
  type Evaluation,
  type MeasureContext,
  type PartSource,
  type ValuePart,
} from "@builder/core";
import { collectRefs, parseExpr } from "@builder/format/pure";
import type { Translator } from "../../i18n/index.ts";
import { choiceOf, choiceTexts, formatValue, ptext, thingName } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";
import { stepTitle } from "./model.ts";

type Words = Pick<Translator, "t" | "list">;

/** "Folk Moorfolk": a thing named with its kind, so the player knows which choice it was. */
export function thingLabel(lp: LoadedPackage, id: string, { t }: Words): string {
  const kind = lp.pkg.things.find((x) => x.id === id)?.kind;
  const kindName = kind ? ptext(lp, `kind.${kind}.name`) : undefined;
  const name = thingName(lp, id);
  return kindName ? t("explain.thing", { kind: kindName, name }) : name;
}

function valueName(lp: LoadedPackage, id: string): string {
  return (id === "level" ? ptext(lp, "level.name") : ptext(lp, `value.${id}.name`)) ?? id;
}

/** What a part is "from"; undefined for the number a value starts at. */
export function partLabel(
  lp: LoadedPackage,
  ev: Evaluation,
  source: PartSource,
  w: Words,
): string | undefined {
  switch (source.kind) {
    case "start":
    case "unclear":
      return undefined;
    case "thing":
      return thingLabel(lp, source.thing, w);
    case "values":
      return w.list(source.values.map((v) => valueName(lp, v)));
    case "choice": {
      // A choice a thing brought along is named after that thing.
      const step = ev.steps.find((s) => s.id === ev.choices[source.choice]?.step);
      const by = step?.origin === "granted" ? step.grantedBy[0] : undefined;
      if (by) return thingLabel(lp, by, w);
      return choiceTexts(lp, source.choice).title || stepTitle(lp, ev, source.choice);
    }
  }
}

/** "8 from Calling Lantern Bearer + 2 from Folk Hillfolk"; `bare` parts get no "from". */
export function sumText(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  valueId: string,
  parts: readonly ValuePart[],
  w: Words,
  bare: (s: PartSource) => boolean = () => false,
): string {
  return parts
    .map((p, i) => {
      const n = formatValue(lp, ctx, valueId, Math.abs(p.amount));
      const label = bare(p.source) ? undefined : partLabel(lp, ev, p.source, w);
      const body = label ? `${n} ${w.t("explain.from", { source: label })}` : n;
      if (i === 0) return (p.amount < 0 ? "−" : "") + body;
      return (p.amount < 0 ? " − " : " + ") + body;
    })
    .join("");
}

/**
 * Where a value comes from, for a line under it: "from Folk Moorfolk", or
 * the parts that add up to it. Undefined if there is nothing to say (the
 * value is just its start, or a minimum or maximum cut it).
 */
export function valueOrigin(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  valueId: string,
  w: Words,
): string | undefined {
  const exp = explainValue(lp.pkg, ev, valueId);
  if (!exp || exp.parts.every((p) => partLabel(lp, ev, p.source, w) === undefined)) return undefined;
  if (exp.parts.length === 1) {
    const label = partLabel(lp, ev, exp.parts[0]!.source, w);
    return label ? w.t("explain.from", { source: label }) : undefined;
  }
  return sumText(lp, ctx, ev, valueId, exp.parts, w);
}

/**
 * One line per target of a distribute answer. A target that is added to
 * something else on the sheet (a base and a bonus) shows the whole sum:
 * "Grace: 7 + 1 from Ferry Child (Upbringing) = 8".
 */
export function distributeLines(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  state: ChoiceState,
  targets: readonly string[],
  assign: Readonly<Record<string, number>>,
  w: Words,
): string[] {
  return targets.map((target) => {
    const shown = totalOf(lp.pkg, target) ?? target;
    const exp = explainValue(lp.pkg, ev, shown);
    if (exp && exp.parts.length > 1) {
      const own = (s: PartSource) => s.kind === "choice" && s.choice === state.id;
      const sum = sumText(lp, ctx, ev, shown, exp.parts, w, own);
      return `${valueName(lp, shown)}: ${sum} = ${formatValue(lp, ctx, shown, exp.total)}`;
    }
    const n = assign[target];
    return `${valueName(lp, target)} ${n === undefined ? "–" : formatValue(lp, ctx, target, n)}`;
  });
}

/**
 * Steps not answered yet whose answer still changes this value: a gift of
 * "10 + a score" shown before the score is chosen. Titles, in flow order.
 */
export function laterSteps(lp: LoadedPackage, ev: Evaluation, valueId: string): string[] {
  const defs = new Map(lp.pkg.values.map((v) => [v.id, v]));
  const things = new Map(lp.pkg.things.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const sources: string[] = [];
    const def = defs.get(id);
    if (def?.formula !== undefined) sources.push(def.formula);
    for (const h of ev.things)
      for (const g of things.get(h.id)?.grants ?? [])
        if (g.value === id && (g.atLevel ?? 1) <= ev.level && typeof g.add === "string") sources.push(g.add);
    for (const src of sources) for (const r of collectRefs(parseExpr(src)).values) walk(r);
  };
  walk(valueId);
  const steps: string[] = [];
  for (const state of Object.values(ev.choices)) {
    const c = choiceOf(lp, state.id);
    const sets =
      c?.kind === "distribute" ? c.targets : c?.kind === "number" && c.target !== undefined ? [c.target] : [];
    if (state.status === "answered" || !sets.some((v) => seen.has(v))) continue;
    if (!steps.includes(state.step)) steps.push(state.step);
  }
  const order = ev.steps.map((s) => s.id);
  return steps.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((s) => stepTitle(lp, ev, s));
}

export interface OriginGroup {
  /** The thing the player picked that brought the others. */
  from: string;
  label: string;
  things: string[];
}

/**
 * Things the character has without having picked them, grouped by the
 * picked thing that brought them (following gifts of gifts to the start).
 */
export function originGroups(lp: LoadedPackage, ev: Evaluation, w: Words): OriginGroup[] {
  const held = new Map(ev.things.map((h) => [h.id, h]));
  const rootOf = (id: string): string => {
    let at = id;
    const seen = new Set<string>();
    while (held.get(at)?.grantedBy !== undefined && !seen.has(at)) {
      seen.add(at);
      at = held.get(at)!.grantedBy!;
    }
    return at;
  };
  const groups = new Map<string, OriginGroup>();
  for (const h of ev.things) {
    if (h.grantedBy === undefined || h.pickedIn !== undefined) continue;
    const from = rootOf(h.id);
    let g = groups.get(from);
    if (!g) {
      g = { from, label: thingLabel(lp, from, w), things: [] };
      groups.set(from, g);
    }
    const name = thingName(lp, h.id);
    if (name) g.things.push(name);
  }
  return [...groups.values()].filter((g) => g.things.length > 0);
}

export interface LevelGrowth {
  /** Values that follow the level alone (a formula of the level, a table by level). */
  own: string[];
  /** Values a held thing raises by a table by level, by that thing. */
  byThing: { thing: string; values: string[] }[];
}

/**
 * Numbers that grow with the level and nothing else, for "what grows with
 * your level": "Practice 6, because level 20". Values that also depend on
 * choices (stamina from a score) are explained with their own sums instead.
 */
export function levelGrowth(lp: LoadedPackage, ev: Evaluation): LevelGrowth {
  const named = (id: string) => ptext(lp, `value.${id}.name`) !== undefined && (ev.values[id] ?? 0) !== 0;
  const own = lp.pkg.values
    .filter((v) => {
      if (v.byLevel !== undefined) return true;
      if (v.formula === undefined) return false;
      const refs = collectRefs(parseExpr(v.formula));
      return refs.values.size === 1 && refs.values.has("level");
    })
    .map((v) => v.id)
    .filter(named);
  const things = new Map(lp.pkg.things.map((x) => [x.id, x]));
  const byThing: LevelGrowth["byThing"] = [];
  const taken = new Set(own);
  for (const h of ev.things) {
    const values = (things.get(h.id)?.grants ?? [])
      .filter((g) => g.value !== undefined && typeof g.add === "object" && (g.atLevel ?? 1) <= ev.level)
      .map((g) => g.value!)
      .filter((id) => named(id) && !taken.has(id));
    for (const id of values) taken.add(id);
    if (values.length > 0) byThing.push({ thing: h.id, values });
  }
  return { own, byThing };
}
