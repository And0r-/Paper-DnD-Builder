/**
 * Long option lists (a level-20 character picks among dozens of options):
 * when to offer a search, and how to cut the list into short groups.
 */
import type { Thing } from "@builder/format/pure";
import { ptext } from "../package-text.ts";
import type { LoadedPackage } from "../packages.ts";

export function groupOptions(things: Thing[]): { group: string | undefined; things: Thing[] }[] {
  if (!things.some((th) => th.group)) return [{ group: undefined, things }];
  const groups: { group: string | undefined; things: Thing[] }[] = [];
  for (const th of things) {
    let g = groups.find((x) => x.group === th.group);
    if (!g) {
      g = { group: th.group, things: [] };
      groups.push(g);
    }
    g.things.push(th);
  }
  return groups;
}

export const SEARCH_FROM = 12;

/**
 * Groups of a long list (from SEARCH_FROM options): the recommended options
 * first, then the rest by the package's groups or, without groups, by rank
 * when the package names ranks (`rank.name`): 100 options read as ten short
 * lists. Short lists keep the package's order.
 */
export function longListGroups(
  lp: LoadedPackage,
  things: Thing[],
  long: boolean,
  recommended: readonly string[],
  recommendedTitle: string,
): { group: string | undefined; title: string | undefined; things: Thing[] }[] {
  const named = (gs: ReturnType<typeof groupOptions>) =>
    gs.map((g) => ({ ...g, title: g.group ? ptext(lp, `group.${g.group}.name`) : undefined }));
  if (!long) return named(groupOptions(things));
  const top = things.filter((th) => recommended.includes(th.id));
  const rest = things.filter((th) => !recommended.includes(th.id));
  const head = top.length > 0 ? [{ group: "-recommended", title: recommendedTitle, things: top }] : [];
  const rankWord = ptext(lp, "rank.name");
  const ranks = [...new Set(rest.flatMap((th) => (th.rank !== undefined ? [th.rank] : [])))].sort(
    (a, b) => a - b,
  );
  if (rest.some((th) => th.group) || rankWord === undefined || ranks.length < 2)
    return [...head, ...named(groupOptions(rest))];
  const byRank = ranks.map((r) => ({
    group: `-rank-${r}`,
    title: ptext(lp, `rank.${r}.name`) ?? `${rankWord} ${r}`,
    things: rest.filter((th) => th.rank === r),
  }));
  const unranked = rest.filter((th) => th.rank === undefined);
  return [
    ...head,
    ...byRank,
    ...(unranked.length > 0 ? [{ group: "-rank-none", title: undefined, things: unranked }] : []),
  ];
}
