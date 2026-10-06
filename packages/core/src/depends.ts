/**
 * Which values change when another one does: read from the package's
 * formulas and from the value grants of the things a character has. The
 * sheet uses it for "these depend on it", so a player who changes a number
 * in pencil knows what else to change.
 */
import { collectRefs, parseExpr, type ContentPackage } from "@builder/format/pure";
import type { Evaluation } from "./evaluate.ts";

/**
 * For each value (and `level`) that others are made from: every value that
 * changes with it, directly or through other values, in package order.
 * Values nothing depends on are left out. Grants count only for things the
 * character has, from the level they apply.
 */
export function dependentValues(
  pkg: ContentPackage,
  ev: Pick<Evaluation, "things" | "level">,
): Record<string, string[]> {
  /** value → values it is made from */
  const uses = new Map<string, Set<string>>();
  const add = (target: string, refs: Iterable<string>) => {
    const set = uses.get(target) ?? new Set<string>();
    for (const r of refs) if (r !== target) set.add(r);
    uses.set(target, set);
  };
  const refsOf = (src: string): Set<string> => collectRefs(parseExpr(src)).values;

  for (const v of pkg.values) {
    if (v.formula !== undefined) add(v.id, refsOf(v.formula));
    else if (v.byLevel !== undefined) add(v.id, ["level"]);
  }
  const things = new Map(pkg.things.map((t) => [t.id, t]));
  for (const h of ev.things) {
    for (const g of things.get(h.id)?.grants ?? []) {
      if (g.value === undefined || g.add === undefined || (g.atLevel ?? 1) > ev.level) continue;
      if (typeof g.add === "string") add(g.value, refsOf(g.add));
      else if (typeof g.add === "object") add(g.value, ["level"]);
    }
  }

  const order = pkg.values.map((v) => v.id);
  const result: Record<string, string[]> = {};
  for (const source of ["level", ...order]) {
    const reached = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const [target, from] of uses) {
        if (reached.has(target)) continue;
        if (from.has(source) || [...from].some((f) => reached.has(f))) {
          reached.add(target);
          grew = true;
        }
      }
    }
    reached.delete(source);
    if (reached.size > 0) result[source] = order.filter((id) => reached.has(id));
  }
  return result;
}
