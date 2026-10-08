/**
 * Creating and changing drafts. Every edit of a draft, from whatever
 * client, goes through {@link applyChange}: the server applies it, stores
 * the result and (later) tells everyone else watching the same draft.
 */
import { declaredChoiceId, type ContentPackage } from "@builder/format/pure";
import type { DraftChange, DraftDocument } from "./draft.ts";
import { evaluateDraft, trackThings, type Evaluation } from "./evaluate.ts";
import { judgeAnswer, type Problem } from "./judge.ts";
import { assignPicks } from "./pool.ts";

export type ChangeError =
  | { code: "levelOutOfRange"; min: number; max: number }
  /** `levelUp`: the new level is not above the current one. */
  | { code: "levelNotHigher"; level: number }
  | { code: "unknownChoice" }
  | { code: "notAsked" }
  /** `pool`: the step is not asked now or has no shared list. */
  | { code: "unknownStep" }
  | { code: "noAnswerNeeded" }
  | { code: "answerDoesNotFit"; problem: Problem }
  /** Tracks given, but the package has none (SPEC 9.7). */
  | { code: "noTracks" }
  /** Not an option of the tracks choice. */
  | { code: "unknownTrack"; thing: string }
  /** More tracks than levels to give them to. */
  | { code: "tooManyTracks"; most: number }
  /** `levelUp`: this track may not be added at this level; `notMet` as in `TrackOption`. */
  | { code: "trackNotAllowed"; thing: string; level: number; notMet: string[] };

export type ChangeResult = { ok: true; doc: DraftDocument } | { ok: false; error: ChangeError };

export function newDraft(pkg: ContentPackage, level = pkg.flow.level.default): ChangeResult {
  const range = levelRange(pkg, level);
  if (range) return { ok: false, error: range };
  return { ok: true, doc: { level, answers: {} } };
}

function levelRange(pkg: ContentPackage, level: number): ChangeError | undefined {
  const { min, max } = pkg.flow.level;
  if (!Number.isInteger(level) || level < min || level > max) return { code: "levelOutOfRange", min, max };
  return undefined;
}

/**
 * Applies one change. A new answer must fit the choice as it is asked right
 * now; answers further down that stop fitting are kept and marked by the
 * evaluation, so going back restores them.
 */
export function applyChange(pkg: ContentPackage, doc: DraftDocument, change: DraftChange): ChangeResult {
  if (change.type === "setLevel") {
    const range = levelRange(pkg, change.level);
    if (range) return { ok: false, error: range };
    const next: DraftDocument = { ...doc, level: change.level };
    // Going back to the level a raise started from (or below) ends the raise.
    if (next.levelBefore !== undefined && change.level <= next.levelBefore) delete next.levelBefore;
    return { ok: true, doc: next };
  }

  if (change.type === "pool") return applyPool(pkg, doc, change.step, change.picks);
  if (change.type === "tracks") {
    const wrong = checkTracks(pkg, change.tracks, doc.level - 1);
    if (wrong) return { ok: false, error: wrong };
    return { ok: true, doc: withTracks(doc, change.tracks, firstTrack(pkg, doc)) };
  }

  const declared = declaredChoiceId(change.choice);
  const choice = pkg.flow.choices.find((c) => c.id === declared);
  if (!choice) return { ok: false, error: { code: "unknownChoice" } };
  if (change.answer === null || change.answer === undefined) {
    const answers = { ...doc.answers };
    delete answers[change.choice];
    return { ok: true, doc: { ...doc, answers } };
  }
  if (choice.kind === "info") return { ok: false, error: { code: "noAnswerNeeded" } };

  const ev = evaluateDraft(pkg, doc);
  const state = ev.choices[change.choice];
  if (!state) return { ok: false, error: { code: "notAsked" } };
  // On a list step the options already leave out what another choice of the list holds.
  const ctx = {
    ...(state.options ? { options: state.options } : {}),
    ...(state.count !== undefined ? { count: state.count } : {}),
    ...(state.min !== undefined ? { min: state.min } : {}),
    ...(state.max !== undefined ? { max: state.max } : {}),
    ...(state.raise ? { raise: state.raise } : {}),
  };
  const j = judgeAnswer(choice, change.answer, ctx);
  if (j.status === "invalid") {
    return { ok: false, error: { code: "answerDoesNotFit", problem: j.problem ?? "badShape" } };
  }
  const next = { ...doc, answers: { ...doc.answers, [change.choice]: change.answer } };
  // A new first track takes over the levels that named the old one (SPEC 9.7).
  const old = firstTrack(pkg, doc);
  const first = firstTrack(pkg, next);
  if (doc.tracks && old !== undefined && first !== undefined && old !== first)
    return {
      ok: true,
      doc: withTracks(
        next,
        doc.tracks.map((t) => (t === old ? first : t)),
        first,
      ),
    };
  return { ok: true, doc: next };
}

/** The stored answer of the tracks choice, if the package has tracks. */
function firstTrack(pkg: ContentPackage, doc: DraftDocument): string | undefined {
  const choice = pkg.flow.level.tracks?.choice;
  const pick =
    choice !== undefined ? (doc.answers[choice] as { pick?: unknown } | undefined)?.pick : undefined;
  return typeof pick === "string" ? pick : undefined;
}

function checkTracks(pkg: ContentPackage, tracks: readonly string[], most: number): ChangeError | undefined {
  // Without tracks every level is the character's: only "none" fits.
  if (!pkg.flow.level.tracks) return tracks.length > 0 ? { code: "noTracks" } : undefined;
  const things = trackThings(pkg);
  const unknown = tracks.find((t) => !things.has(t));
  if (unknown !== undefined) return { code: "unknownTrack", thing: unknown };
  if (tracks.length > most) return { code: "tooManyTracks", most: Math.max(0, most) };
  return undefined;
}

/**
 * The draft with these tracks for levels 2 on. Entries at the end that name
 * the first track say nothing and are left out, so a character in one track
 * keeps a draft without `tracks`, as before tracks.
 */
function withTracks(doc: DraftDocument, tracks: readonly string[], first: string | undefined): DraftDocument {
  const list = [...tracks];
  while (list.length > 0 && list.at(-1) === first) list.pop();
  const next = { ...doc };
  if (list.length > 0) next.tracks = list;
  else delete next.tracks;
  return next;
}

/**
 * Raises a character to a higher level. Every answer stays; the steps the
 * new levels add (`atLevel` above the old level) are asked on top. The old
 * level is kept as `levelBefore` until the character is finished again; a
 * second raise before that keeps the first one's starting level, so the
 * new steps of both raises stay recognisable.
 *
 * With tracks (SPEC 9.7), `tracks` names the track of each new level, in
 * order; a level left out goes to the track of the level before it. A track
 * the character does not have yet is added only if its `addRequires` (and
 * with `addRequiresCurrent` those of the tracks it has) hold for the
 * character as it is before that level.
 */
export function levelUp(
  pkg: ContentPackage,
  doc: DraftDocument,
  level: number,
  tracks?: readonly string[],
): ChangeResult {
  const range = levelRange(pkg, level);
  if (range) return { ok: false, error: range };
  if (level <= doc.level) return { ok: false, error: { code: "levelNotHigher", level: doc.level } };
  const raised: DraftDocument = { ...doc, level, levelBefore: doc.levelBefore ?? doc.level };
  if (!pkg.flow.level.tracks)
    return tracks?.length ? { ok: false, error: { code: "noTracks" } } : { ok: true, doc: raised };
  const wrong = checkTracks(pkg, tracks ?? [], level - doc.level);
  if (wrong) return { ok: false, error: wrong };
  const ev = evaluateDraft(pkg, doc);
  const levels = ev.tracks?.levels ?? [];
  // Without a first track there is nothing to add to: the levels go to the first track once there is one.
  if (levels.length === 0)
    return { ok: true, doc: tracks?.length ? withTracks(raised, tracks, undefined) : raised };
  const entries = levels.slice(1);
  let before = ev;
  for (let at = doc.level + 1; at <= level; at++) {
    const track = tracks?.[at - doc.level - 1] ?? entries.at(-1) ?? levels[0]!;
    if (!entries.includes(track) && track !== levels[0]) {
      if (at > doc.level + 1)
        before = evaluateDraft(pkg, withTracks({ ...doc, level: at - 1 }, entries, levels[0]));
      const option = before.tracks?.options.find((o) => o.thing === track);
      if (option && !option.allowed)
        return {
          ok: false,
          error: { code: "trackNotAllowed", thing: track, level: at, notMet: option.notMet ?? [] },
        };
    }
    entries.push(track);
  }
  return { ok: true, doc: withTracks(raised, entries, levels[0]) };
}

/** What a raise from level `from` brought, read from the evaluation at the new level. */
export interface LevelUpState {
  from: number;
  to: number;
  /** Steps the raise added (`atLevel > from`), in step order. */
  newSteps: string[];
  /**
   * Choices the raise added (`atLevel > from`), in step order. A step that
   * was there before can get a new choice (a gather step), so this can name
   * choices of a step not in `newSteps`.
   */
  newChoices: string[];
  /**
   * Every step not done, in step order: the steps with a new choice, and an
   * older step that asks for more at the new level (a pick count from a
   * table by level, for example). The character is complete when it is empty.
   */
  openSteps: string[];
}

export function levelUpState(ev: Evaluation, from: number): LevelUpState {
  return {
    from,
    to: ev.level,
    newSteps: ev.steps.filter((s) => s.atLevel > from).map((s) => s.id),
    newChoices: ev.steps.flatMap((s) => s.choices).filter((c) => (ev.choices[c]?.atLevel ?? 0) > from),
    openSteps: ev.steps.filter((s) => s.status !== "done").map((s) => s.id),
  };
}

function applyPool(pkg: ContentPackage, doc: DraftDocument, stepId: string, picks: string[]): ChangeResult {
  const ev = evaluateDraft(pkg, doc);
  const pool = ev.steps.find((s) => s.id === stepId)?.pool;
  if (!pool) return { ok: false, error: { code: "unknownStep" } };
  const doesNotFit = (problem: Problem): ChangeResult => ({
    ok: false,
    error: { code: "answerDoesNotFit", problem },
  });
  if (new Set(picks).size !== picks.length) return doesNotFit("duplicate");
  if (picks.some((p) => !pool.options.includes(p))) return doesNotFit("notOffered");
  if (picks.length > pool.count) return doesNotFit("tooMany");
  const slots = pool.choices.map((c) => ({ count: c.count, offers: new Set(c.options) }));
  const keep = new Map(pool.choices.flatMap((c, i) => c.picks.map((p) => [p, i] as const)));
  const at = assignPicks(slots, picks, keep);
  if (!at) return doesNotFit("notOffered");
  const answers = { ...doc.answers };
  pool.choices.forEach((c, i) => {
    const mine = picks.filter((p) => at.get(p) === i);
    const kind = ev.choices[c.choice]!.kind;
    if (mine.length === 0) delete answers[c.choice];
    else answers[c.choice] = kind === "pickOne" ? { pick: mine[0] } : { picks: mine };
  });
  return { ok: true, doc: { ...doc, answers } };
}

/** What a character list shows: the name and the arguments of the `summary.line` text. */
export interface DraftSummary {
  name: string | null;
  level: number;
  complete: boolean;
  /**
   * By variable name: a thing key (for `{ choice }`), a number (for
   * `{ value }`) or the tracks with their levels (for `{ tracks }`, see {@link headTracks}).
   */
  line: Record<string, string | number | TrackLevels[] | null>;
}

/** A track with its levels, for a line such as "A 3 / B 2". */
export interface TrackLevels {
  thing: string;
  levels: number;
}

/**
 * The tracks as a head line shows them (SPEC 9.7): the one with the most
 * levels first, on a tie the one taken earlier.
 */
export function headTracks(ev: Pick<Evaluation, "tracks">): TrackLevels[] {
  return (ev.tracks?.list ?? [])
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.levels - a.t.levels || a.i - b.i)
    .map(({ t }) => ({ thing: t.thing, levels: t.levels }));
}

/** "A 3 / B 2" with the names given; a single track is just its name. */
export function tracksText(
  tracks: readonly TrackLevels[],
  name: (thing: string) => string,
  number: (n: number) => string = String,
): string {
  if (tracks.length === 1) return name(tracks[0]!.thing);
  return tracks.map((t) => `${name(t.thing)} ${number(t.levels)}`).join(" / ");
}

export function summarize(pkg: ContentPackage, doc: DraftDocument, ev: Evaluation): DraftSummary {
  const nameState = ev.choices[pkg.flow.characterName];
  const name =
    nameState?.status === "answered" ? ((nameState.answer as { text: string }).text.trim() ?? null) : null;
  const line: DraftSummary["line"] = {};
  for (const [key, arg] of Object.entries(pkg.flow.summary.line)) {
    if ("value" in arg) {
      line[key] = arg.value === "level" ? doc.level : (ev.values[arg.value] ?? null);
    } else if ("choice" in arg) {
      const held = ev.things.find((t) => t.pickedIn === arg.choice);
      line[key] = held?.id ?? null;
    } else {
      const tracks = headTracks(ev);
      line[key] = tracks.length > 0 ? tracks : null;
    }
  }
  return { name, level: doc.level, complete: ev.complete, line };
}
