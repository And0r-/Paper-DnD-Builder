/**
 * Where numbers and things come from, in words: "7 + 1 from Ferry Child
 * (Upbringing) = 8", "from Folk Moorfolk". A player who sees a number change, or
 * a thing on the sheet they never picked, can see why.
 */
import {
  explainValue,
  grantAppliesFrom,
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

export interface RowValues {
  /** The value the target adds up to (a base and a bonus make the score), or the target itself. */
  total: string;
  /** The number the sheet prints next to that score (a `scoreColumn` entry's `derived`), if any. */
  derived?: string;
}

/**
 * What a row of a distribute choice changes: the score it is part of, and
 * the number that score gives at the table. Follows plain sums from the
 * target to a score the sheet prints with a derived number.
 */
export function rowValues(lp: LoadedPackage, target: string): RowValues {
  const total = totalOf(lp.pkg, target) ?? target;
  const seen = new Set<string>();
  for (let at: string | undefined = total; at !== undefined && !seen.has(at); at = totalOf(lp.pkg, at)) {
    seen.add(at);
    for (const s of lp.pkg.sheet.sections) {
      if (s.kind !== "scoreColumn") continue;
      const entry = s.scores.find((e) => e.value === at);
      if (entry?.derived !== undefined) return { total, derived: entry.derived };
    }
  }
  return { total };
}

/** Name of the value a row of a distribute choice stands for: "Strength", not "Strength: base". */
export function rowName(lp: LoadedPackage, target: string): string {
  const { total } = rowValues(lp, target);
  return ptext(lp, `value.${total}.name`) ?? valueName(lp, target);
}

/**
 * A row's number with what else adds to its score, named, while the player
 * moves it, in the order of the score's formula: a base reads "8 + 1 from
 * Ferry Child (Upbringing) = 9", a bonus "15 from Scores + 2 = 17".
 * Undefined if nothing else adds to it.
 */
export function rowSum(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  choiceId: string,
  target: string,
  amount: number,
  w: Words,
): string | undefined {
  const { total } = rowValues(lp, target);
  if (total === target) return undefined;
  const exp = explainValue(lp.pkg, ev, total);
  if (!exp) return undefined;
  const mine = (s: PartSource) => s.kind === "choice" && s.choice === choiceId;
  const others = exp.parts.filter((p) => !mine(p.source)).map((p) => ({ ...p }));
  // A target not answered yet is still at its start number: that part is the row's own.
  if (ev.inputs[target]?.choice !== choiceId) {
    const start = others.find((p) => p.source.kind === "start");
    if (start) start.amount -= lp.pkg.values.find((v) => v.id === target)?.default ?? 0;
  }
  const rest = others.filter((p) => p.amount !== 0);
  if (rest.length === 0) return undefined;
  const own: ValuePart = { amount, source: { kind: "choice", choice: choiceId } };
  const parts = rowIsBase(lp, target) ? [own, ...rest] : [...rest, own];
  const sum = parts.reduce((n, p) => n + p.amount, 0);
  return `${sumText(lp, ctx, ev, total, parts, w, mine)} = ${formatValue(lp, ctx, total, sum)}`;
}

/**
 * Whether a row's target comes first in the sum it is part of (a base, not
 * a bonus on top): its sum then starts with the row's own number.
 */
export function rowIsBase(lp: LoadedPackage, target: string): boolean {
  const { total } = rowValues(lp, target);
  if (total === target) return true;
  const formula = lp.pkg.values.find((v) => v.id === total)?.formula;
  return formula !== undefined && [...collectRefs(parseExpr(formula)).values][0] === target;
}

/**
 * What a row's number gives at the table, "Might bonus +1": the derived
 * number of its score. Only while the row shows what is worked out (a row
 * of numbers still being handed out is not saved yet): no number rather
 * than a wrong one.
 */
export function rowEffect(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  choiceId: string,
  target: string,
  amount: number | undefined,
  w: Words,
): string | undefined {
  const { derived } = rowValues(lp, target);
  if (derived === undefined || amount === undefined) return undefined;
  const input = ev.inputs[target];
  const counted = input && input.choice === choiceId ? input.amount : undefined;
  if (
    counted !== amount &&
    !(counted === undefined && amount === (lp.pkg.values.find((v) => v.id === target)?.default ?? 0))
  )
    return undefined;
  return w.t("dist.effect", {
    name: valueName(lp, derived),
    value: formatValue(lp, ctx, derived, ev.values[derived] ?? 0, true),
  });
}

/**
 * One line per target of a distribute answer. A target that is added to
 * something else on the sheet (a base and a bonus) shows the whole sum,
 * every part named: "Grace: 7 from Scores + 1 from Ferry Child (Upbringing) = 8".
 * A score already summed up in an earlier step (`summed`, filled as the
 * lines are made) gets only this step's part: "Grace + 1".
 */
export function distributeLines(
  lp: LoadedPackage,
  ctx: MeasureContext,
  ev: Evaluation,
  state: ChoiceState,
  targets: readonly string[],
  assign: Readonly<Record<string, number>>,
  w: Words,
  summed: Set<string> = new Set(),
): string[] {
  const raise = state.raise !== undefined;
  // A bonus of 0 adds nothing worth a line.
  const shownTargets = targets.filter((v) => raise || rowIsBase(lp, v) || (assign[v] ?? 0) !== 0);
  return shownTargets.map((target) => {
    const shown = raise ? target : (totalOf(lp.pkg, target) ?? target);
    const n = assign[target];
    if (summed.has(shown) && n !== undefined) {
      // A choice a thing brought along names the thing; the step's own title would say nothing new.
      const from = partLabel(lp, ev, { kind: "choice", choice: state.id }, w);
      const own = choiceTexts(lp, state.id).title || stepTitle(lp, ev, state.id);
      const label = from && from !== own ? ` ${w.t("explain.from", { source: from })}` : "";
      return `${valueName(lp, shown)} + ${formatValue(lp, ctx, shown, n)}${label}`;
    }
    const exp = explainValue(lp.pkg, ev, shown);
    if (exp && exp.parts.length > 1) {
      summed.add(shown);
      const sum = sumText(lp, ctx, ev, shown, exp.parts, w);
      return `${valueName(lp, shown)}: ${sum} = ${formatValue(lp, ctx, shown, exp.total)}`;
    }
    return `${raise ? valueName(lp, target) : rowName(lp, target)} ${n === undefined ? "–" : formatValue(lp, ctx, target, n)}`;
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
  /** Ids of the things it brought, in order; each has a name. */
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
    // A feature that brings a thing of the same name (a feature that teaches
    // a language called like it) is named once.
    const name = thingName(lp, h.id);
    if (name && !g.things.some((id) => thingName(lp, id) === name)) g.things.push(h.id);
  }
  return [...groups.values()].filter((g) => g.things.length > 0);
}

export interface LevelGrowth {
  /** Values that follow the level alone (a formula of the level, a table by level). */
  own: string[];
  /** Values a held thing raises by a table by level, by that thing, and the track it came through. */
  byThing: { thing: string; values: string[]; track?: string }[];
}

/** Values each thing names in a stat (`"uses": {"value": "…"}`), by value. */
function statUsers(lp: LoadedPackage): Map<string, Set<string>> {
  const users = new Map<string, Set<string>>();
  for (const x of lp.pkg.things) {
    for (const s of Object.values(x.stats ?? {})) {
      if (typeof s !== "object" || !("value" in s)) continue;
      const set = users.get(s.value) ?? new Set<string>();
      set.add(x.id);
      users.set(s.value, set);
    }
  }
  return users;
}

/**
 * Numbers that grow with the level and nothing else, for "what grows with
 * your level": "Practice 6, because level 20". Values that also depend on
 * choices (stamina from a score) are explained with their own sums instead.
 * A table by level that things name in a stat (uses of one ability) belongs
 * to those things: it only shows when the character has one of them.
 */
export function levelGrowth(lp: LoadedPackage, ev: Evaluation): LevelGrowth {
  const named = (id: string) => ptext(lp, `value.${id}.name`) !== undefined && (ev.values[id] ?? 0) !== 0;
  const users = statUsers(lp);
  const held = new Set(ev.things.map((h) => h.id));
  const own = lp.pkg.values
    .filter((v) => {
      if (v.byLevel !== undefined) {
        const by = users.get(v.id);
        return by === undefined || [...by].some((x) => held.has(x));
      }
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
      .filter(
        (g) => g.value !== undefined && typeof g.add === "object" && grantAppliesFrom(ev, h, g) !== undefined,
      )
      .map((g) => g.value!)
      .filter((id) => named(id) && !taken.has(id));
    for (const id of values) taken.add(id);
    if (values.length > 0)
      byThing.push({ thing: h.id, values, ...(h.track !== undefined && { track: h.track }) });
  }
  return { own, byThing };
}
