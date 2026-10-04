/**
 * Where a number comes from, in parts a player can follow: "15 + 2 = 17",
 * "8 from X + 2 from Y". Only sums are taken apart; any other term of a
 * formula stays one part, named after the values it uses. The result is an
 * explanation, never a second calculation: if the parts do not add up to the
 * value (a minimum or maximum cut it), there is no explanation.
 */
import { collectRefs, parseExpr, type ContentPackage, type Expr } from "@builder/format/pure";
import { evaluationScope, type Evaluation } from "./evaluate.ts";
import { evaluateParsed } from "./expr.ts";

export type PartSource =
  /** Set by an answer to this choice. */
  | { kind: "choice"; choice: string }
  /** Given by a thing the character has. */
  | { kind: "thing"; thing: string }
  /** Worked out from other values (`level` included). */
  | { kind: "values"; values: string[] }
  /** The fixed number a value starts at. */
  | { kind: "start" };

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

  const negate = (parts: ValuePart[]) => parts.map((p) => ({ ...p, amount: -p.amount }));

  const terms = (e: Expr, owner: PartSource, seen: Set<string>): ValuePart[] => {
    if (e.type === "binary" && (e.op === "+" || e.op === "-")) {
      const right = terms(e.right, owner, seen);
      return [...terms(e.left, owner, seen), ...(e.op === "-" ? negate(right) : right)];
    }
    if (e.type === "num") return [{ amount: e.value, source: owner }];
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
    // A thing's gift stays the thing's, even if it grows with the level.
    if (owner.kind === "thing" || refs.length === 0) return [{ amount, source: owner }];
    return [{ amount, source: { kind: "values", values: refs } }];
  };

  const partsOf = (id: string, seen: Set<string>): ValuePart[] => {
    const def = defs.get(id);
    if (!def) return [];
    const out: ValuePart[] = [];
    const input = ev.inputs[id];
    if (def.formula !== undefined) out.push(...terms(parseExpr(def.formula), { kind: "start" }, seen));
    else if (input) out.push({ amount: input.amount, source: { kind: "choice", choice: input.choice } });
    else out.push({ amount: def.default ?? 0, source: { kind: "start" } });
    for (const held of ev.things) {
      for (const g of things.get(held.id)?.grants ?? []) {
        if (g.value !== id || (g.atLevel ?? 1) > ev.level || g.add === undefined) continue;
        const add: Expr = typeof g.add === "number" ? { type: "num", value: g.add } : parseExpr(g.add);
        out.push(...terms(add, { kind: "thing", thing: held.id }, seen));
      }
    }
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
