/**
 * Tracks (SPEC 9.7): which thing each character level went to, and what
 * that means for a grant of a thing that belongs to a track. Pure helpers
 * on the list of levels, shared by the walk and by everything that reads
 * an evaluation afterwards (explanations, dependencies, the sheet).
 */
import type { Grant } from "@builder/format/pure";

/**
 * The track of each character level, level 1 first: the first track, then
 * the draft's entry for each further level. An entry that is missing or no
 * track (a key that vanished from a newer package) means the first track.
 */
export function trackLevels(
  first: string,
  entries: readonly string[] | undefined,
  level: number,
  isTrack: (id: string) => boolean,
): string[] {
  const out = [first];
  for (let l = 2; l <= level; l++) {
    const e = entries?.[l - 2];
    out.push(e !== undefined && isTrack(e) ? e : first);
  }
  return out;
}

/** Levels in `track` up to character level `at`. */
export function levelIn(levels: readonly string[], track: string, at: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(at, levels.length); i++) if (levels[i] === track) n++;
  return n;
}

/** The character level at which `track` reached its level `n`, or undefined if it has not. */
export function reachedAt(levels: readonly string[], track: string, n: number): number | undefined {
  let seen = 0;
  for (let i = 0; i < levels.length; i++) if (levels[i] === track && ++seen >= n) return i + 1;
  return undefined;
}

/**
 * The character level from which a grant of a thing applies, or undefined
 * if it does not apply up to `level`. For a thing in a track, `atLevel`
 * counts the levels in that track and `only` asks whether the track is the
 * first one; any other thing counts the character level and never gets an
 * `only` grant.
 */
export function grantFrom(
  g: Pick<Grant, "atLevel" | "only">,
  track: string | undefined,
  levels: readonly string[],
  level: number,
): number | undefined {
  const n = g.atLevel ?? 1;
  if (track === undefined) return g.only === undefined && n <= level ? n : undefined;
  if (g.only !== undefined && (g.only === "first") !== (track === levels[0])) return undefined;
  const at = reachedAt(levels, track, n);
  return at !== undefined && at <= level ? at : undefined;
}

/**
 * The tracks of a character with their levels, in the order taken: the
 * level each got first, and whether it was added (every track but the first).
 */
export function trackList(
  levels: readonly string[],
): { thing: string; levels: number; from: number; added: boolean }[] {
  const out: { thing: string; levels: number; from: number; added: boolean }[] = [];
  levels.forEach((thing, i) => {
    const known = out.find((t) => t.thing === thing);
    if (known) known.levels++;
    else out.push({ thing, levels: 1, from: i + 1, added: i > 0 });
  });
  return out;
}
