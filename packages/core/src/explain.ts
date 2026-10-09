/**
 * Where a number comes from, in parts a player can follow: "15 + 2 = 17",
 * "8 from X + 2 from Y". Sums are taken apart; a `max`, `min` or `if` is
 * followed into the branch that gave its number, and a branch taken because
 * of `has('thing')` is that thing's. Any other term stays one part, named
 * after the values it uses. The result is an explanation, never a second
 * calculation: if the parts do not add up to the value (a minimum or maximum
 * cut it), there is no explanation.
 */
import { collectRefs, parseExpr, type ContentPackage, type Expr } from "@builder/format/pure";
import {
  byLevel,
  byValue,
  evaluationScope,
  grantAppliesFrom,
  grantTableLevel,
  type Evaluation,
} from "./evaluate.ts";
import { evaluateParsed, evaluateParsedCondition } from "./expr.ts";

export type PartSource =
  /** Set or raised by an answer to this choice (for a copy, the copy's id). */
  | { kind: "choice"; choice: string }
  /**
   * Given by a thing the character has. With more than one track (SPEC
   * 9.7), a thing in a track names it and the level reached in it.
   */
  | { kind: "thing"; thing: string; track?: string; trackLevel?: number }
  /** Worked out from other values (`level` included). */
  | { kind: "values"; values: string[] }
  /** The fixed number a value starts at. */
  | { kind: "start" }
  /** Could not be told for sure (two branches of a `max` gave the same number): no source rather than a wrong one. */
  | { kind: "unclear" };

export interface ValuePart {
  amount: number;
  source: PartSource;
}

export interface ValueExplanation {
  total: number;
  /** In order of appearance; parts from the same source are added up, zero parts left out. */
  parts: ValuePart[];
}

const EPSILON = 1e-9;

function sum(parts: readonly ValuePart[]): number {
  return parts.reduce((n, p) => n + p.amount, 0);
}

function sourceKey(s: PartSource): string {
  switch (s.kind) {
    case "choice":
      return `c:${s.choice}`;
    case "thing":
      return `t:${s.thing}`;
    case "values":
      return `v:${s.values.join(",")}`;
    case "start":
      return "s";
    case "unclear":
      return "u";
  }
}

/** Explains one value of an evaluated draft, or undefined if it cannot be explained as a sum. */
export function explainValue(
  pkg: ContentPackage,
  ev: Evaluation,
  valueId: string,
): ValueExplanation | undefined {
  const defs = new Map(pkg.values.map((v) => [v.id, v]));
  const things = new Map(pkg.things.map((t) => [t.id, t]));
  const scope = evaluationScope(pkg, ev);
  const total = ev.values[valueId];
  if (total === undefined) return undefined;
  const manyTracks = (ev.tracks?.list.length ?? 0) > 1;

  const negate = (parts: ValuePart[]) => parts.map((p) => ({ ...p, amount: -p.amount }));

  /**
   * `whole`: the term is all a thing gives (a grant's `add`, or the branch of
   * it that counts). A gift of just another value ("add the wit bonus") is
   * the thing's, named after it; inside a sum the value keeps its own name.
   */
  const terms = (e: Expr, owner: PartSource, seen: Set<string>, whole = false): ValuePart[] => {
    if (e.type === "binary" && (e.op === "+" || e.op === "-")) {
      const right = terms(e.right, owner, seen);
      return [...terms(e.left, owner, seen), ...(e.op === "-" ? negate(right) : right)];
    }
    if (e.type === "num") return [{ amount: e.value, source: owner }];
    if (e.type === "call" && e.fn === "if" && e.args.length === 3) {
      const cond = e.args[0]!;
      const yes = evaluateParsedCondition(cond, scope);
      // "if(has('x'), 16, 0)": the 16 is x's, unless a thing already gives it.
      const by = yes && owner.kind !== "thing" ? hasThing(cond) : undefined;
      return terms(yes ? e.args[1]! : e.args[2]!, by ? { kind: "thing", thing: by } : owner, seen, whole);
    }
    if (e.type === "call" && (e.fn === "max" || e.fn === "min") && e.args.length > 0) {
      const amounts = e.args.map((a) => evaluateParsed(a, scope));
      const amount = e.fn === "max" ? Math.max(...amounts) : Math.min(...amounts);
      const winners = e.args.filter((_, i) => Math.abs(amounts[i]! - amount) < EPSILON);
      if (winners.length === 1) return terms(winners[0]!, owner, seen, whole);
      // A tie. Values that all gave the number can be named together; a
      // branch that hangs on a thing cannot be told apart from the others.
      const refs = collectRefs({ type: "call", fn: e.fn, args: winners });
      if (owner.kind === "thing") return [{ amount, source: owner }];
      if (refs.things.size > 0) return [{ amount, source: { kind: "unclear" } }];
      if (refs.values.size === 0) return [{ amount, source: owner }];
      return [{ amount, source: { kind: "values", values: [...refs.values] } }];
    }
    if (e.type === "ref" && whole && owner.kind === "thing")
      return [{ amount: scope.value(e.name), source: owner }];
    if (e.type === "ref" && e.name !== "level") {
      // A value without a formula is made of what set it and what was given:
      // show those parts instead of the value's own name.
      const def = defs.get(e.name);
      if (def && def.formula === undefined && !seen.has(e.name)) {
        const inner = partsOf(e.name, new Set([...seen, e.name]));
        if (Math.abs(sum(inner) - scope.value(e.name)) < EPSILON) return inner;
      }
      return [{ amount: scope.value(e.name), source: { kind: "values", values: [e.name] } }];
    }
    const amount = evaluateParsed(e, scope);
    const refs = [...collectRefs(e).values];
    const shares = valueShares(
      e,
      refs.filter((r) => r !== "level"),
    );
    if (shares) {
      // What is left once the values are taken out: the owner's, or the level's.
      const rest = refs.includes("level") && owner.kind !== "thing" ? levelSource : owner;
      return [...shares.parts, { amount: shares.rest, source: rest }];
    }
    // A thing's gift stays the thing's, even if it grows with the level.
    if (owner.kind === "thing" || refs.length === 0) return [{ amount, source: owner }];
    return [{ amount, source: { kind: "values", values: refs } }];
  };

  const levelSource: PartSource = { kind: "values", values: ["level"] };

  /**
   * Takes the values out of a term that is not a plain sum: a value's share
   * is the term with it minus the term with it set to 0, and what is left
   * with all of them at 0 is the rest. "(level - 1) * (6 + bonus)" gives the
   * bonus (level - 1) * bonus and leaves (level - 1) * 6. Only if that is a
   * fair split: each point of a value adds the same (in "floor((x - 10) / 2)"
   * a 0 is no "without x"), and the shares do not hang on each other (in
   * "trained * bonus" neither is the other's). Otherwise undefined, and the
   * term stays whole; also if it uses no value but the level.
   */
  const valueShares = (
    e: Expr,
    names: readonly string[],
  ): { parts: ValuePart[]; rest: number } | undefined => {
    if (names.length === 0) return undefined;
    const at = (set: ReadonlyMap<string, number>): number =>
      evaluateParsed(e, { ...scope, value: (n) => set.get(n) ?? scope.value(n) });
    try {
      const whole = at(new Map());
      const parts: ValuePart[] = [];
      for (const name of names) {
        const base = at(new Map([[name, 0]]));
        const step = at(new Map([[name, 1]])) - base;
        const even = [2, -1].every((n) => Math.abs(at(new Map([[name, n]])) - base - n * step) < EPSILON);
        if (!even || Math.abs(whole - base - scope.value(name) * step) >= EPSILON) return undefined;
        parts.push({ amount: whole - base, source: { kind: "values", values: [name] } });
      }
      const rest = at(new Map(names.map((n) => [n, 0])));
      if (Math.abs(sum(parts) + rest - whole) >= EPSILON) return undefined;
      return { parts, rest };
    } catch {
      return undefined;
    }
  };

  const partsOf = (id: string, seen: Set<string>): ValuePart[] => {
    const def = defs.get(id);
    if (!def) return [];
    const out: ValuePart[] = [];
    const input = ev.inputs[id];
    if (def.formula !== undefined) out.push(...terms(parseExpr(def.formula), { kind: "start" }, seen));
    else if (def.byLevel !== undefined)
      out.push({
        amount: byLevel(pkg, def.byLevel, ev.level),
        source: { kind: "values", values: ["level"] },
      });
    else if (def.byValue !== undefined)
      out.push({
        amount: byValue(def.table!, scope.value(def.byValue)),
        source: { kind: "values", values: [def.byValue] },
      });
    else if (input) out.push({ amount: input.amount, source: { kind: "choice", choice: input.choice } });
    else out.push({ amount: def.default ?? 0, source: { kind: "start" } });
    for (const held of ev.things) {
      for (const g of things.get(held.id)?.grants ?? []) {
        if (g.value !== id || g.add === undefined || grantAppliesFrom(ev, held, g) === undefined) continue;
        const owner: PartSource = {
          kind: "thing",
          thing: held.id,
          ...(held.track !== undefined && manyTracks
            ? { track: held.track, trackLevel: grantTableLevel(ev, held) }
            : {}),
        };
        if (typeof g.add === "object") {
          out.push({ amount: byLevel(pkg, g.add.byLevel, grantTableLevel(ev, held)), source: owner });
          continue;
        }
        const add: Expr = typeof g.add === "number" ? { type: "num", value: g.add } : parseExpr(g.add);
        out.push(...terms(add, owner, seen, true));
      }
    }
    for (const r of ev.raises[id] ?? [])
      out.push({ amount: r.amount, source: { kind: "choice", choice: r.choice } });
    return out;
  };

  const raw = partsOf(valueId, new Set([valueId]));
  if (Math.abs(sum(raw) - total) >= EPSILON) return undefined;

  const merged = new Map<string, ValuePart>();
  for (const p of raw) {
    const key = sourceKey(p.source);
    const had = merged.get(key);
    if (had) had.amount += p.amount;
    else merged.set(key, { ...p });
  }
  return { total, parts: [...merged.values()].filter((p) => Math.abs(p.amount) >= EPSILON) };
}

/** The thing a condition is `has('thing')`, if it is just that. */
function hasThing(e: Expr): string | undefined {
  const first = e.type === "call" && e.fn === "has" ? e.args[0] : undefined;
  return first?.type === "str" ? first.value : undefined;
}

/**
 * The value that adds `part` to something else, if there is exactly one
 * whose formula is a plain sum using it: a base and a bonus, set in two
 * places, add up to the number on the sheet.
 */
export function totalOf(pkg: ContentPackage, part: string): string | undefined {
  const found: string[] = [];
  for (const v of pkg.values) {
    if (v.formula === undefined) continue;
    if (sumRefs(parseExpr(v.formula))?.includes(part)) found.push(v.id);
  }
  return found.length === 1 ? found[0] : undefined;
}

/** The values a formula adds up, or undefined if it is not a sum of values and numbers. */
function sumRefs(e: Expr): string[] | undefined {
  if (e.type === "ref") return [e.name];
  if (e.type === "num") return [];
  if (e.type === "binary" && e.op === "+") {
    const l = sumRefs(e.left);
    const r = sumRefs(e.right);
    return l && r ? [...l, ...r] : undefined;
  }
  return undefined;
}

/**
 * For a value that adds up the levels of tracks (dice of a kind, SPEC 9.7):
 * those the character has levels in, in the formula's order. The package's
 * own text names every track it counts; this is what the character has.
 * Undefined for any other value, or if the character has none of them.
 */
export function ownLevelTracks(pkg: ContentPackage, ev: Evaluation, valueId: string): string[] | undefined {
  const formula = pkg.values.find((v) => v.id === valueId)?.formula;
  const tracks = formula === undefined ? undefined : levelSum(parseExpr(formula));
  const scope = evaluationScope(pkg, ev);
  const had = tracks?.filter((t) => (scope.levelOf?.(t) ?? 0) > 0) ?? [];
  return had.length > 0 ? had : undefined;
}

/** The tracks a formula adds the levels of, if it is just that: "levelOf('a') + levelOf('b')". */
function levelSum(e: Expr): string[] | undefined {
  if (e.type === "call" && e.fn === "levelOf" && e.args.length === 1 && e.args[0]!.type === "str")
    return [e.args[0]!.value];
  if (e.type === "binary" && e.op === "+") {
    const l = levelSum(e.left);
    const r = levelSum(e.right);
    return l && r ? [...l, ...r] : undefined;
  }
  return undefined;
}
