/**
 * Tracks on screen (more than one calling for one character), before the
 * rule core knows them. The shapes follow the approved concept (AND-262,
 * sections 1, 3 and 6): the draft keeps `tracks`, one thing per character
 * level from level 2 on; level 1 always belongs to the first track, the
 * answer of the track choice. Everything here is pure, so the screens can
 * run on sample data now and on the core's answers later (AND-251).
 */

/** What the core will say about a track for the next level. */
export interface TrackOption {
  /** The thing that would get the level. */
  thing: string;
  /** False when its requirement to be added is not met (checked as the character was before). */
  allowed: boolean;
  /** Why not, in the package language, one or two short sentences. */
  reason?: string;
}

/** The levels of a character, as the draft keeps them. */
export interface TrackPlan {
  /** Character level. */
  level: number;
  /** The answer of the track choice: owns level 1 and every level without an entry. */
  first: string;
  /** One thing per character level from level 2 on; shorter lists mean "the first track". */
  tracks: readonly string[];
}

/** One track with its levels, in the order it was taken. */
export interface TrackLevels {
  thing: string;
  levels: number;
  /** The character level on which this track got its first level. */
  from: number;
}

/** The thing that got each character level, level 1 first. */
export function levelOwners(plan: TrackPlan): string[] {
  const out = [plan.first];
  for (let level = 2; level <= plan.level; level++) out.push(plan.tracks[level - 2] ?? plan.first);
  return out;
}

/** Levels per track, in the order the tracks were taken; the first track always first. */
export function trackLevels(plan: TrackPlan): TrackLevels[] {
  const out: TrackLevels[] = [];
  levelOwners(plan).forEach((thing, i) => {
    const known = out.find((t) => t.thing === thing);
    if (known) known.levels++;
    else out.push({ thing, levels: 1, from: i + 1 });
  });
  return out;
}

/**
 * The order of the head line "A 3 / B 2" (concept 6.5): most levels first,
 * on a tie the one taken first. One track gives one entry.
 */
export function headOrder(plan: TrackPlan): TrackLevels[] {
  return trackLevels(plan)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.levels - a.t.levels || a.i - b.i)
    .map(({ t }) => t);
}

/** "A 3 / B 2" with the names given; one track alone is only its name. */
export function headLine(plan: TrackPlan, name: (thing: string) => string): string {
  const order = headOrder(plan);
  if (order.length === 1) return name(order[0]!.thing);
  return order.map((t) => `${name(t.thing)} ${t.levels}`).join(" / ");
}

/** The level a track reaches with the next character level. */
export function nextTrackLevel(plan: TrackPlan, thing: string): number {
  return (trackLevels(plan).find((t) => t.thing === thing)?.levels ?? 0) + 1;
}

/** The plan with `thing` getting character level `level` (2 or more). */
export function withLevel(plan: TrackPlan, level: number, thing: string): TrackPlan {
  const tracks = levelOwners(plan).slice(1);
  while (tracks.length < level - 1) tracks.push(plan.first);
  tracks[level - 2] = thing;
  return { ...plan, level: Math.max(plan.level, level), tracks: trimmed(tracks, plan.first) };
}

/** The plan with every level back in the first track. */
export function allFirst(plan: TrackPlan): TrackPlan {
  return { ...plan, tracks: [] };
}

/** True when every level belongs to the first track. */
export function isSingle(plan: TrackPlan): boolean {
  return levelOwners(plan).every((t) => t === plan.first);
}

/**
 * A new first track (the answer of the track choice changed, concept 3):
 * levels that named the old first track go to the new one.
 */
export function withFirst(plan: TrackPlan, first: string): TrackPlan {
  const tracks = levelOwners(plan)
    .slice(1)
    .map((t) => (t === plan.first ? first : t));
  return { ...plan, first, tracks: trimmed(tracks, first) };
}

/**
 * The levels of tracks whose requirement no longer holds (concept 3: they
 * keep counting, the step says "does not fit any more"). Character levels.
 */
export function unfitLevels(plan: TrackPlan, unfit: ReadonlySet<string>): number[] {
  return levelOwners(plan)
    .map((t, i) => (i > 0 && unfit.has(t) ? i + 1 : 0))
    .filter((l) => l > 0);
}

/** Entries at the end that name the first track say nothing: the draft stays as small as before. */
function trimmed(tracks: string[], first: string): string[] {
  const out = [...tracks];
  while (out.length > 0 && out.at(-1) === first) out.pop();
  return out;
}
