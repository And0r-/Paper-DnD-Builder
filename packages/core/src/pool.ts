/**
 * One shared list of options for several pick choices (a gather step with
 * `together: "list"`, SPEC 9.4). The player picks from the list; every pick
 * belongs to exactly one choice that offers it. Which one is worked out
 * here, as a bipartite matching of picks to the choices' places.
 */

/** One choice of the list: how many it takes and what it offers. */
export interface PoolSlot {
  count: number;
  offers: ReadonlySet<string>;
}

/**
 * Assigns every pick (all distinct) to a slot that offers it, without exceeding any count.
 * Picks found in `keep` stay in that slot when possible, so a new pick only
 * moves earlier ones if it has to. Returns the slot index per pick, or
 * undefined if no assignment exists.
 */
export function assignPicks(
  slots: readonly PoolSlot[],
  picks: readonly string[],
  keep: ReadonlyMap<string, number> = new Map(),
): Map<string, number> | undefined {
  const at = new Map<string, number>();
  const load = slots.map(() => 0);
  for (const p of picks) {
    const s = keep.get(p);
    if (s !== undefined && slots[s]?.offers.has(p) && load[s]! < slots[s]!.count) {
      at.set(p, s);
      load[s]!++;
    }
  }
  // Augmenting path: put `pick` into a slot that offers it, moving a pick
  // already there into another slot if that is the only way.
  const place = (pick: string, seen: Set<number>): boolean => {
    // A free place first, so nothing moves without need.
    for (let s = 0; s < slots.length; s++) {
      if (seen.has(s) || !slots[s]!.offers.has(pick) || load[s]! >= slots[s]!.count) continue;
      at.set(pick, s);
      load[s]!++;
      return true;
    }
    for (let s = 0; s < slots.length; s++) {
      if (seen.has(s) || !slots[s]!.offers.has(pick)) continue;
      seen.add(s);
      for (const [other, os] of at) {
        if (os !== s) continue;
        if (place(other, seen)) {
          // `other` moved and freed its place in s (place() counted it in its new slot).
          load[s]!--;
          at.set(pick, s);
          load[s]!++;
          return true;
        }
      }
    }
    return false;
  };
  for (const p of picks) {
    if (at.has(p)) continue;
    if (!place(p, new Set())) return undefined;
  }
  return at;
}

/**
 * Fills the list greedily from `candidates` (in order), keeping only
 * candidates that still leave an assignment. Because the sets of picks that
 * can be assigned form a matroid, this reaches the largest possible number
 * of picks whenever the candidates allow it.
 */
export function fillPicks(slots: readonly PoolSlot[], candidates: readonly string[]): string[] {
  const total = slots.reduce((n, s) => n + s.count, 0);
  const picks: string[] = [];
  for (const c of candidates) {
    if (picks.length >= total) break;
    if (picks.includes(c)) continue;
    if (assignPicks(slots, [...picks, c])) picks.push(c);
  }
  return picks;
}
