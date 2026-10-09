/**
 * The rule core: from a package and a draft, derive everything else.
 *
 * - which steps are asked, in which order (SPEC 9.4),
 * - what the character has (SPEC 6, "What a character has"),
 * - every value (SPEC 7),
 * - which answers still fit and whether the character is complete.
 *
 * Steps are walked in order and every condition is evaluated with what the
 * earlier steps gave. A step therefore only ever depends on steps before
 * it, which keeps the result unambiguous and easy to explain to a player:
 * changing an answer can only affect what comes after it.
 */
import {
  collectRefs,
  COPY_SEPARATOR,
  declaredChoiceId,
  parseExpr,
  type Amount,
  type Choice,
  type ContentPackage,
  type FilledText,
  type Grant as FormatGrant,
  type OptionSource,
  type Thing,
  type Tracks,
} from "@builder/format/pure";
import type { DraftDocument } from "./draft.ts";
import { evaluateCondition, evaluateNumber, RuleError, type ExprScope } from "./expr.ts";
import { judgeAnswer, type ChoiceContext, type Problem } from "./judge.ts";
import { assignPicks, fillPicks, type PoolSlot } from "./pool.ts";
import { grantFrom, levelIn, trackLevels, trackList } from "./tracks.ts";

export type ChoiceStatus = "answered" | "incomplete" | "missing" | "invalid" | "info";

export interface ChoiceState {
  /** The choice id; for a copy (a repeatable thing picked again) `<choice>@<where picked>`. */
  id: string;
  /** Copies only: the declared choice whose rules and texts this copy uses. */
  copyOf?: string;
  kind: Choice["kind"];
  /** Step the choice is shown on. */
  step: string;
  optional: boolean;
  status: ChoiceStatus;
  /** Why a stored answer does not fit (status `invalid`). */
  problem?: Problem;
  /** The stored answer, unchanged, if any. */
  answer?: unknown;
  /** Things that may be picked now (pick choices). */
  options?: string[];
  /** How many to pick (pickMany). */
  count?: number;
  upTo?: boolean;
  /** Picks or points still open; for the `missing` text. */
  remaining?: number;
  /** Allowed range (number choices). */
  min?: number;
  max?: number;
  /** Recommended picks (pick choices) or assignment (distribute). */
  recommended?: string[] | { method: number; assign: Record<string, number> };
  /** Badge text key by offered option (pick choices; shown instead of "recommended") or by target (distribute). */
  badges?: Record<string, string>;
  /**
   * Choices with `held`: things the character already has that an offered
   * option is `about`, in option order. Those options come first in `recommended`,
   * the ones also in the package's `recommend` ahead of the rest.
   */
  held?: string[];
  /** For `info` choices: what the thing picked in choice `of` gives at this level. */
  info?: InfoContent;
  /** Active text variant: its texts `choice.<id>.variant.<textVariant>.*` replace the base texts. */
  textVariant?: string;
  /** Things that grant this choice (granted choices), in grant order. */
  grantedBy?: string[];
  /**
   * Problem `duplicate` because a grant gives a pick anyway (often a later
   * step): each such pick with the thing that grants it.
   */
  givenBy?: Record<string, string>;
  /** Character level from which the choice is asked (the level of its step). */
  atLevel: number;
  /** The track the choice came through (SPEC 9.7); a choice of an added track is a copy `<choice>@<track>`. */
  track?: string;
  /** Distribute choices with the method `raise`: what each target can still take. */
  raise?: RaiseState;
}

export interface RaiseState {
  /** Points to give in all. */
  points: number;
  /** Each target's value before this choice. */
  before: Record<string, number>;
  /** Most points each target can take here: `maxPerTarget`, less if the cap (or the value's max) is near. */
  most: Record<string, number>;
}

export interface InfoContent {
  /** The pickOne choice this info is about. */
  of: string;
  /** Thing picked there, or null if nothing is picked yet. */
  thing: string | null;
  things: string[];
  /** How many of a thing in `things`, where the grant gives more than one. */
  counts: Record<string, number>;
  values: { value: string; add: number }[];
  choices: string[];
}

export interface StepState {
  id: string;
  choices: string[];
  /** `flow`: listed in flow.json; `granted`: inserted because a thing grants the choice. */
  origin: "flow" | "granted";
  /** Things that grant this step's choice (granted steps). */
  grantedBy: string[];
  /** Earlier steps whose answers this step depends on. */
  dependsOn: string[];
  status: "done" | "open" | "needsAttention";
  /** Gather steps that show their choices together: the gather group and how. */
  gather?: { group: string; together: "sections" | "list" };
  /** Steps with `together: "list"`: the shared list of options. */
  pool?: PoolState;
  /**
   * Character level from which the step is asked: `flow.level.min` for flow
   * steps; for granted steps the level at which the grant applies (through
   * every grant on the way). A character raised from level n gets the steps
   * with `atLevel > n` added.
   */
  atLevel: number;
  /** The track the step's choices came through (SPEC 9.7), if all came through one. */
  track?: string;
  /** With `track`: the level in that track at which the step is asked. */
  trackLevel?: number;
}

/**
 * One list of options for all choices of a step (`together: "list"`).
 * Options are offered as before the step, so every choice offers its full list;
 * a pick counts for one choice only.
 */
export interface PoolState {
  /** Every option of every choice, without things the character had before the step; in choice order, then option order. */
  options: string[];
  /**
   * The choices, in step order: how many each takes, what it offers (also
   * what another choice of the list holds now) and which picks count for it.
   */
  choices: {
    choice: string;
    count: number;
    upTo: boolean;
    options: string[];
    picks: string[];
    remaining: number;
  }[];
  /** All picks, in choice order. */
  picks: string[];
  /** Sum of the counts, and how many of them are still open. */
  count: number;
  remaining: number;
  /** Options that cannot be added to the current picks: no choice left that offers them. */
  blocked: string[];
  /** Things the character had before the step, of the kinds the choices offer ("you already have"). */
  held: HeldThing[];
  /** A full set of picks: the choices' recommendations first, filled up from the list. */
  recommended: string[];
}

export interface HeldThing {
  id: string;
  kind: string;
  /** The choice it was picked in, if it was picked. */
  pickedIn?: string;
  /** The thing that granted it, if it was granted. */
  grantedBy?: string;
  /** Every character of the package has it (`flow.grants`); then it has no step. */
  everyone?: true;
  /** Step that brought it to the character; absent for things every character has. */
  step?: string;
  /** Character level from which the character has it. */
  atLevel: number;
  /** How many of it, if more than one: the `count` of every grant that gives it, added up. */
  count?: number;
  /** The track it belongs to (SPEC 9.7): a track itself, or a thing that came through one. */
  track?: string;
}

/** A track the character could take its next level in (SPEC 9.7). */
export interface TrackOption {
  thing: string;
  allowed: boolean;
  /**
   * Only if not allowed: the things whose `addRequires` does not hold for
   * the character as it is now, the track itself first, then (with
   * `addRequiresCurrent`) tracks it has. Text of each: `<thing>.addReason`.
   */
  notMet?: string[];
}

/** The character's tracks, with `flow.level.tracks` (SPEC 9.7). */
export interface TracksState {
  /** The tracks choice; the builder's step for the levels comes right after its step. */
  choice: string;
  /** The first track: the answer of the tracks choice, or null while there is none that counts. */
  first: string | null;
  /** The track of each character level, level 1 first; empty without a first track. */
  levels: string[];
  /** Each track with its levels, in the order taken, and the character level of its first level. */
  list: { thing: string; levels: number; from: number; added: boolean }[];
  /** Every option of the tracks choice for the next level (a raise), and whether it may take it. */
  options: TrackOption[];
  /**
   * Added tracks whose `addRequires` (with `addRequiresCurrent`, also the
   * tracks it had then) does not hold for the character as it was before
   * the level that added them. They still count; the character is not complete.
   */
  unfit: string[];
}

export interface Evaluation {
  level: number;
  steps: StepState[];
  choices: Record<string, ChoiceState>;
  /** Everything the character has, in the order it was gained. */
  things: HeldThing[];
  values: Record<string, number>;
  /** Values set directly by an answer (distribute, number), with the choice that set them. */
  inputs: Record<string, { amount: number; choice: string }>;
  /** Points added to values by `raise` answers, per value in step order, with the choice that gave them and its level. */
  raises: Record<string, { amount: number; choice: string; atLevel: number }[]>;
  /**
   * Things the character has that were picked again in a choice with
   * `options.owned` (for example "your favourite knack"), with those choices.
   */
  marks: Record<string, string[]>;
  /** Choices that still need an answer (missing, incomplete or invalid, not optional). */
  open: string[];
  complete: boolean;
  /** Choices with a stored answer that are not asked at the moment (kept for going back). */
  inactiveAnswers: string[];
  /** Only with `flow.level.tracks`. */
  tracks?: TracksState;
}

interface Indexes {
  things: Map<string, Thing>;
  choices: Map<string, Choice>;
  values: Map<string, ContentPackage["values"][number]>;
  /** Things of a kind some grant gives with a `count`: only these are counted. */
  counted: Set<string>;
}

/**
 * A kind is counted once the package gives any thing of it with a `count`
 * (arrows by the score make all gear counted): a staff from two kits is two
 * staffs. Kinds never given with a count (skills, languages) stay once.
 */
function countedThings(pkg: ContentPackage, things: Map<string, Thing>): Set<string> {
  const kinds = new Set(
    pkg.things.flatMap((t) =>
      (t.grants ?? []).flatMap((g) => (g.count !== undefined ? [things.get(g.thing!)?.kind] : [])),
    ),
  );
  return new Set(pkg.things.filter((t) => kinds.has(t.kind)).map((t) => t.id));
}

const indexCache = new WeakMap<ContentPackage, Indexes>();

function indexes(pkg: ContentPackage): Indexes {
  let ix = indexCache.get(pkg);
  if (!ix) {
    const things = new Map(pkg.things.map((t) => [t.id, t]));
    ix = {
      things,
      choices: new Map(pkg.flow.choices.map((c) => [c.id, c])),
      values: new Map(pkg.values.map((v) => [v.id, v])),
      counted: countedThings(pkg, things),
    };
    indexCache.set(pkg, ix);
  }
  return ix;
}

/** Mutable state of the walk through the steps. */
class Character {
  readonly held = new Map<string, HeldThing>();
  /** Base values set by answers (distribute, number). */
  readonly inputs = new Map<string, number>();
  /** The choice that set each input. */
  readonly inputChoices = new Map<string, string>();
  /** Points added by raise answers, per value, with the level of the choice that gave them. */
  readonly raises = new Map<string, { amount: number; choice: string; atLevel: number }[]>();
  private memo = new Map<string, number>();
  private computing = new Set<string>();

  /** Things offered so far in pick choices (not `owned` ones). */
  readonly offered = new Set<string>();
  /**
   * Things a grant gave after a choice offered them, with the thing that
   * granted them: that choice should not have offered them (see evaluateDraft).
   */
  readonly clashes = new Map<string, string>();

  private readonly pkg: ContentPackage;
  private readonly ix: Indexes;
  readonly level: number;
  /** The draft's `tracks`: the track of each level from 2 on. */
  private readonly entries: readonly string[] | undefined;
  /** The choice whose answer is the first track (SPEC 9.7), if the package has tracks. */
  readonly tracksChoice: string | undefined;
  /**
   * With tracks (SPEC 9.7): the track of each character level, level 1
   * first. Empty until the tracks choice gives the first track.
   */
  levels: string[] = [];

  constructor(pkg: ContentPackage, ix: Indexes, level: number, entries?: readonly string[]) {
    this.pkg = pkg;
    this.ix = ix;
    this.level = level;
    this.entries = entries;
    this.tracksChoice = pkg.flow.level.tracks?.choice;
    this.scope = this.scopeAt(level);
  }

  /**
   * The answer of the tracks choice: gives the first track at level 1, then
   * every added track at the level that adds it, each with what it grants.
   */
  giveTracks(first: string, via: { pickedIn: string }, step: string, choices: Grant[]): void {
    const tracks = trackThings(this.pkg);
    this.levels = trackLevels(first, this.entries, this.level, (id) => tracks.has(id));
    this.memo.clear();
    for (const t of trackList(this.levels)) this.give(t.thing, via, step, t.from, choices, 1, t.thing);
  }

  /** The character level from which a grant of a thing in `track` (or in none) applies, if it does. */
  grantFrom(g: Pick<FormatGrant, "atLevel" | "only">, track: string | undefined): number | undefined {
    return grantFrom(g, track, this.levels, this.level);
  }

  /** The level a table by level in a thing's grant looks up at character level `at`: in its track, if any. */
  tableLevel(track: string | undefined, at = this.level): number {
    return track === undefined ? at : levelIn(this.levels, track, at);
  }

  /**
   * Gives a thing and everything it grants up to the level; the choices
   * granted on the way are added to `choices`. `atLevel` is the level from
   * which the character has it.
   */
  give(
    id: string,
    via: { pickedIn?: string; grantedBy?: string; everyone?: true },
    step: string | undefined,
    atLevel: number,
    choices: Grant[],
    count = 1,
    track?: string,
  ): void {
    const thing = this.ix.things.get(id);
    // A key that vanished from a newer package version simply stops counting.
    if (!thing) return;
    if (via.grantedBy !== undefined && !thing.repeatable && !this.ix.counted.has(id) && this.offered.has(id))
      this.clashes.set(id, via.grantedBy);
    const held = this.held.get(id);
    // Given again: the counts add up (8 arrows and 20 arrows are 28 arrows), for
    // things the package counts at all; a skill from two sources is one skill.
    if (held && via.grantedBy !== undefined && this.ix.counted.has(id))
      this.held.set(id, { ...held, count: (held.count ?? 1) + count });
    // A thing counts once; only a repeatable one asks its choices again, once per pick.
    if (held && !thing.repeatable) return;
    if (!held) {
      this.held.set(id, {
        id,
        kind: thing.kind,
        ...via,
        ...(step !== undefined ? { step } : {}),
        atLevel,
        ...(count > 1 ? { count } : {}),
        ...(track !== undefined ? { track } : {}),
      });
      this.memo.clear();
    }
    const again = held !== undefined;
    // A thing given again keeps the track it came through first.
    const own = held ? held.track : track;
    // The choices of an added track are asked anew, as copies (SPEC 9.7).
    const copy = thing.repeatable
      ? (via.pickedIn ?? via.grantedBy)
      : own !== undefined && own !== this.levels[0]
        ? own
        : undefined;
    for (const g of thing.grants ?? []) {
      const at = this.grantFrom(g, own);
      if (at === undefined) continue;
      const from = Math.max(atLevel, at);
      if (g.thing !== undefined && !again)
        this.give(g.thing, { grantedBy: id }, step, from, choices, g.count ?? 1, own);
      else if (g.choice !== undefined)
        choices.push({
          choice: copy ? `${g.choice}${COPY_SEPARATOR}${copy}` : g.choice,
          by: id,
          atLevel: from,
          ...(own !== undefined ? { track: own } : {}),
        });
    }
  }

  /** Things picked in choices with `options.owned`, with those choices in step order. */
  readonly marks = new Map<string, string[]>();

  mark(id: string, choice: string): void {
    const list = this.marks.get(id) ?? [];
    list.push(choice);
    this.marks.set(id, list);
  }

  addRaises(raises: Record<string, number>, choice: string, atLevel: number): void {
    for (const [k, amount] of Object.entries(raises)) {
      if (amount === 0) continue;
      const list = this.raises.get(k) ?? [];
      list.push({ amount, choice, atLevel });
      this.raises.set(k, list);
    }
    this.memo.clear();
  }

  /**
   * A number, an expression or a table by level, worked out for this
   * character (at `at`, see {@link scopeAt}). A table of a thing in a track
   * goes by the level in that track.
   */
  amount(src: Amount, at = this.level, track?: string): number {
    return typeof src === "object"
      ? byLevel(this.pkg, src.byLevel, this.tableLevel(track, at))
      : evaluateNumber(src, this.scopeAt(at));
  }

  setInputs(inputs: Record<string, number>, choice: string): void {
    for (const [k, v] of Object.entries(inputs)) {
      this.inputs.set(k, v);
      this.inputChoices.set(k, choice);
    }
    this.memo.clear();
  }

  /** The character at its own level. */
  readonly scope: ExprScope;

  /**
   * The character as it was at level `at`: only what it had from that level
   * on, grants and raises up to it, tables and `level` at it. A raise looks
   * at the values this way (SPEC 9.3): a bonus that only comes at a later
   * level must not count against the cap of an earlier raise.
   */
  scopeAt(at: number): ExprScope {
    const had = (h: HeldThing) => h.atLevel <= at;
    return {
      value: (name) => this.value(name, at),
      has: (id) => {
        const h = this.held.get(id);
        return h !== undefined && had(h);
      },
      count: (tag) => {
        let n = 0;
        for (const h of this.held.values()) if (had(h) && this.ix.things.get(h.id)?.tags?.includes(tag)) n++;
        return n;
      },
      levelOf: (id) => levelIn(this.levels, id, at),
    };
  }

  value(name: string, at = this.level): number {
    if (name === "level") return at;
    const key = `${at}:${name}`;
    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    const def = this.ix.values.get(name);
    if (!def) throw new RuleError(`unknown value "${name}"`);
    if (this.computing.has(key)) throw new RuleError(`value "${name}" depends on itself`);
    this.computing.add(key);
    try {
      let result =
        def.formula !== undefined
          ? evaluateNumber(def.formula, this.scopeAt(at))
          : def.byLevel !== undefined
            ? byLevel(this.pkg, def.byLevel, at)
            : def.byValue !== undefined
              ? byValue(def.table!, this.value(def.byValue, at))
              : (this.inputs.get(name) ?? def.default ?? 0);
      for (const h of this.held.values()) {
        if (h.atLevel > at) continue;
        for (const g of this.ix.things.get(h.id)?.grants ?? []) {
          if (g.value !== name) continue;
          const from = this.grantFrom(g, h.track);
          if (from !== undefined && from <= at) result += this.amount(g.add!, at, h.track);
        }
      }
      for (const r of this.raises.get(name) ?? []) if (r.atLevel <= at) result += r.amount;
      if (def.min !== undefined) result = Math.max(def.min, result);
      if (def.max !== undefined) result = Math.min(def.max, result);
      this.memo.set(key, result);
      return result;
    } finally {
      this.computing.delete(key);
    }
  }

  allValues(): Record<string, number> {
    return Object.fromEntries(this.pkg.values.map((v) => [v.id, this.value(v.id)]));
  }
}

/** The entry of a table by level for a level (the last one if the level is past its end). */
export function byLevel(pkg: ContentPackage, table: readonly number[], level: number): number {
  const i = Math.min(Math.max(level - pkg.flow.level.min, 0), table.length - 1);
  return table[i]!;
}

/** The entry of a table by another value (SPEC 7): entry 0 at 0, rounded down, kept within the table. */
export function byValue(table: readonly number[], value: number): number {
  const i = Math.min(Math.max(Math.floor(value), 0), table.length - 1);
  return table[i]!;
}

/** The things of the tracks choice (SPEC 9.7); empty without one. */
export function trackThings(pkg: ContentPackage): Set<string> {
  const choice = indexes(pkg).choices.get(pkg.flow.level.tracks?.choice ?? "");
  return new Set(choice?.kind === "pickOne" ? selectThings(pkg, choice.options).map((t) => t.id) : []);
}

interface Grant {
  choice: string;
  by: string;
  atLevel: number;
  track?: string;
}

interface Gathered {
  choice: string;
  by: string[];
  atLevel: number;
  track?: string;
}

interface PendingStep {
  id: string;
  choices: string[];
  when?: string;
  origin: "flow" | "granted";
  grantedBy: string[];
  atLevel: number;
  track?: string;
  /** Gather steps: the group, how they are shown, and the choices gathered so far. */
  gather?: { group: string; together?: "sections" | "list"; gathered: Gathered[] };
}

/** Things matching an option source, in package order. */
type PickChoice = Extract<Choice, { kind: "pickOne" | "pickMany" }>;

export function selectThings(pkg: ContentPackage, source: OptionSource): Thing[] {
  return pkg.things.filter(
    (t) =>
      (source.kind === undefined || t.kind === source.kind) &&
      (source.ids === undefined || source.ids.includes(t.id)) &&
      (source.tags === undefined || source.tags.every((tag) => t.tags?.includes(tag))),
  );
}

/**
 * What an expression sees of the finished character: every value, every held
 * thing. For conditions evaluated after the walk (sheet sections, SPEC 13).
 */
export function evaluationScope(pkg: ContentPackage, ev: Evaluation): ExprScope {
  const ix = indexes(pkg);
  const held = new Set(ev.things.map((h) => h.id));
  return {
    value: (name) => {
      if (name === "level") return ev.level;
      const v = ev.values[name];
      if (v === undefined) throw new RuleError(`unknown value "${name}"`);
      return v;
    },
    has: (id) => held.has(id),
    count: (tag) => ev.things.filter((h) => ix.things.get(h.id)?.tags?.includes(tag)).length,
    levelOf: (id) => levelIn(ev.tracks?.levels ?? [], id, ev.level),
  };
}

/**
 * For a thing the finished character has: the character level from which a
 * grant of it applies, or undefined if it does not. With tracks a grant of
 * a thing in a track counts the levels in that track (SPEC 9.7).
 */
export function grantAppliesFrom(
  ev: Pick<Evaluation, "level" | "tracks">,
  held: Pick<HeldThing, "track">,
  g: Pick<FormatGrant, "atLevel" | "only">,
): number | undefined {
  return grantFrom(g, held.track, ev.tracks?.levels ?? [], ev.level);
}

/** The level a table by level in a grant of `held` looks up: in its track, if any, else the character level. */
export function grantTableLevel(
  ev: Pick<Evaluation, "level" | "tracks">,
  held: Pick<HeldThing, "track">,
): number {
  return held.track === undefined ? ev.level : levelIn(ev.tracks?.levels ?? [], held.track, ev.level);
}

/**
 * Text key of a text filled with character values (SPEC 6, stats): the first
 * variant whose `when` holds, else `text`. Its `vars` fill either.
 */
export function filledTextKey(v: FilledText, scope: ExprScope): string {
  return v.variants?.find((x) => evaluateCondition(x.when, scope))?.text ?? v.text;
}

/** Things referenced by `has()` in an expression. */
function thingsIn(src: string | undefined): string[] {
  if (src === undefined) return [];
  return [...collectRefs(parseExpr(src)).things];
}

/**
 * Evaluates a draft against a package. Pure: the same inputs always give the
 * same result. Throws {@link RuleError} only if the package itself is broken.
 */
export function evaluateDraft(pkg: ContentPackage, doc: DraftDocument): Evaluation {
  // Steps only look back, so a choice can offer a thing that a later step's
  // grant gives anyway (a talent offered with the folk, then the upbringing
  // grants it): picking it would silently give nothing. Such things are not
  // offered in a second walk; a stored pick of one is a duplicate there and
  // its step asks again. Walks repeat until the set of such things settles
  // (a pick dropped can change what later steps grant); the bound only
  // guards against a package where that never happens.
  let givenLater = new Map<string, string>();
  for (let walks = 1; ; walks++) {
    const { ev, character } = walk(pkg, doc, givenLater);
    const next = new Map(character.clashes);
    for (const id of givenLater.keys()) {
      const by = character.held.get(id)?.grantedBy;
      if (by !== undefined) next.set(id, by);
    }
    if (walks === 4 || sameKeys(next, givenLater)) return ev;
    givenLater = next;
  }
}

function sameKeys(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a.keys()].every((k) => b.has(k));
}

function walk(
  pkg: ContentPackage,
  doc: DraftDocument,
  givenLater: ReadonlyMap<string, string>,
): { ev: Evaluation; character: Character } {
  const ix = indexes(pkg);
  /** The declared choice of an id, also of a copy. */
  const choiceOf = (id: string) => ix.choices.get(declaredChoiceId(id));
  const character = new Character(pkg, ix, doc.level, doc.tracks);
  const choices: Record<string, ChoiceState> = {};
  const steps: StepState[] = [];
  const scheduled = new Set<string>();
  /** Gather steps not reached yet, by group. */
  const gatherAhead = new Map<string, PendingStep>();

  const queue: PendingStep[] = pkg.flow.steps.map((s) => {
    const pending: PendingStep = {
      id: s.id,
      choices: "gather" in s ? [] : s.choices,
      ...(s.when !== undefined ? { when: s.when } : {}),
      origin: "flow",
      grantedBy: [],
      atLevel: pkg.flow.level.min,
    };
    if ("gather" in s) {
      pending.gather = {
        group: s.gather,
        ...(s.together !== undefined ? { together: s.together } : {}),
        gathered: [],
      };
      if (!gatherAhead.has(s.gather)) gatherAhead.set(s.gather, pending);
    } else for (const c of s.choices) scheduled.add(c);
    return pending;
  });

  /**
   * SPEC 9.4: one step per newly granted choice at the front of the queue, in
   * grant order; a choice with a gather group whose step is still ahead waits there.
   */
  const insertGranted = (granted: Grant[]): void => {
    const inserted: PendingStep[] = [];
    for (const g of granted) {
      const group = choiceOf(g.choice)?.gather;
      const gatherStep = group !== undefined ? gatherAhead.get(group) : undefined;
      const waiting = gatherStep?.gather!.gathered.find((w) => w.choice === g.choice);
      if (waiting) {
        if (!waiting.by.includes(g.by)) waiting.by.push(g.by);
        waiting.atLevel = Math.min(waiting.atLevel, g.atLevel);
        continue;
      }
      const existing = inserted.find((p) => p.id === g.choice);
      if (existing) {
        existing.grantedBy.push(g.by);
        existing.atLevel = Math.min(existing.atLevel, g.atLevel);
        continue;
      }
      if (scheduled.has(g.choice)) continue;
      scheduled.add(g.choice);
      const track = g.track !== undefined ? { track: g.track } : {};
      if (gatherStep)
        gatherStep.gather!.gathered.push({ choice: g.choice, by: [g.by], atLevel: g.atLevel, ...track });
      else
        inserted.push({
          id: g.choice,
          choices: [g.choice],
          origin: "granted",
          grantedBy: [g.by],
          atLevel: g.atLevel,
          ...track,
        });
    }
    queue.unshift(...inserted);
  };

  // Things every character has come before the first step; the choices they
  // grant are asked first.
  const fromPackage: Grant[] = [];
  for (const id of pkg.flow.grants ?? [])
    character.give(id, { everyone: true }, undefined, pkg.flow.level.min, fromPackage);
  insertGranted(fromPackage);

  while (queue.length > 0) {
    const step = queue.shift()!;
    const shown = step.when === undefined || evaluateCondition(step.when, character.scope);
    if (step.gather) {
      const { group, together, gathered } = step.gather;
      if (gatherAhead.get(group) === step) gatherAhead.delete(group);
      if (gathered.length === 0) continue;
      // Without `together`, and also if the step is hidden, each gathered
      // choice becomes its own step here: a granted choice is never lost.
      if (together === undefined || !shown) {
        queue.unshift(
          ...gathered.map((g): PendingStep => ({
            id: g.choice,
            choices: [g.choice],
            origin: "granted",
            grantedBy: g.by,
            atLevel: g.atLevel,
            ...(g.track !== undefined ? { track: g.track } : {}),
          })),
        );
        continue;
      }
      step.choices = gathered.map((g) => g.choice);
      step.grantedBy = [...new Set(gathered.flatMap((g) => g.by))];
      step.atLevel = Math.min(...gathered.map((g) => g.atLevel));
      const tracks = new Set(gathered.map((g) => g.track));
      if (tracks.size === 1 && gathered[0]!.track !== undefined) step.track = gathered[0]!.track;
    } else if (!shown) continue;

    const granted: Grant[] = [];
    const refs = new Set<string>(thingsIn(step.when));
    const before = [...character.held.values()];
    // Granted choices on a gathered step: the things that granted each one.
    const grantedByChoice = new Map((step.gather?.gathered ?? []).map((g) => [g.choice, g.by]));
    if (step.origin === "granted") grantedByChoice.set(step.id, step.grantedBy);
    const prepared: Prepared[] = [];
    const atLevelOf = new Map((step.gather?.gathered ?? []).map((g) => [g.choice, g.atLevel]));
    const trackOf = new Map((step.gather?.gathered ?? []).map((g) => [g.choice, g.track]));
    for (const choiceId of step.choices) {
      const choice = choiceOf(choiceId);
      if (!choice) continue;
      const at = atLevelOf.get(choiceId) ?? step.atLevel;
      const track = step.gather ? trackOf.get(choiceId) : step.track;
      const p = prepareChoice(
        pkg,
        choice,
        choiceId,
        step.id,
        at,
        track,
        doc,
        character,
        choices,
        refs,
        givenLater,
      );
      const by = grantedByChoice.get(choiceId);
      if (by) p.state.grantedBy = by;
      choices[choiceId] = p.state;
      prepared.push(p);
      // On a list step every choice is offered as before the step; elsewhere
      // a choice sees the answers of the choices above it.
      if (step.gather?.together !== "list") answerChoice(p, character, step.id, granted);
    }
    let pool: PoolState | undefined;
    if (step.gather?.together === "list") {
      const taken = new Set<string>();
      for (const p of prepared) answerChoice(p, character, step.id, granted, taken);
      pool = poolFor(pkg, prepared, before);
      leaveToOthers(prepared);
    }

    const dependsOn = new Set<string>();
    for (const by of step.grantedBy) {
      const s = character.held.get(by)?.step;
      if (s !== undefined) dependsOn.add(s);
    }
    for (const t of refs) {
      const s = character.held.get(t)?.step;
      if (s !== undefined) dependsOn.add(s);
    }
    dependsOn.delete(step.id);
    const states = step.choices.map((c) => choices[c]).filter((c) => c !== undefined);
    steps.push({
      id: step.id,
      choices: step.choices,
      origin: step.origin,
      grantedBy: step.grantedBy,
      dependsOn: [...dependsOn],
      status: states.some((c) => c.status === "invalid")
        ? "needsAttention"
        : states.every((c) => isSettled(c))
          ? "done"
          : "open",
      ...(step.gather?.together !== undefined
        ? { gather: { group: step.gather.group, together: step.gather.together } }
        : {}),
      ...(pool ? { pool } : {}),
      atLevel: step.atLevel,
      ...(step.track !== undefined
        ? { track: step.track, trackLevel: character.tableLevel(step.track, step.atLevel) }
        : {}),
    });

    // SPEC 9.4: one step per newly granted choice, right after this step.
    insertGranted(granted);
  }

  // An info step shows what the thing gives the finished character: a grant's
  // formula may use a value set by a later step (scores picked after the
  // calling), so it is worked out again once every step has been walked.
  for (const state of Object.values(choices)) {
    const choice = choiceOf(state.id);
    if (choice?.kind === "info" && state.info) state.info = infoFor(pkg, choice.of, choices, character);
  }

  const open = Object.values(choices)
    .filter((c) => !c.optional && !isSettled(c))
    .map((c) => c.id);
  const tracks = pkg.flow.level.tracks ? tracksState(pkg, pkg.flow.level.tracks, character) : undefined;
  const ev: Evaluation = {
    level: doc.level,
    steps,
    choices,
    things: [...character.held.values()],
    values: character.allValues(),
    inputs: Object.fromEntries(
      [...character.inputs].map(([k, amount]) => [k, { amount, choice: character.inputChoices.get(k)! }]),
    ),
    raises: Object.fromEntries(character.raises),
    marks: Object.fromEntries(character.marks),
    open,
    complete: open.length === 0 && (tracks?.unfit.length ?? 0) === 0,
    inactiveAnswers: Object.keys(doc.answers).filter((k) => !(k in choices)),
    ...(tracks ? { tracks } : {}),
  };
  return { ev, character };
}

/**
 * The tracks of the walked character (SPEC 9.7). Adding a track is checked
 * for the character as it was before the level that adds it: for the next
 * level that is the character now; for a track already added, the level
 * before it came.
 */
function tracksState(pkg: ContentPackage, tracks: Tracks, character: Character): TracksState {
  const levels = character.levels;
  const list = trackList(levels);
  const things = indexes(pkg).things;
  /** `thing` and, with `addRequiresCurrent`, the tracks in `had` whose `addRequires` fails at level `at`. */
  const notMet = (thing: string, had: readonly string[], at: number): string[] => {
    const scope = character.scopeAt(at);
    return [thing, ...(tracks.addRequiresCurrent ? had : [])].filter((t) => {
      const req = things.get(t)?.addRequires;
      return req !== undefined && !evaluateCondition(req, scope);
    });
  };
  const current = list.map((t) => t.thing);
  const options = [...trackThings(pkg)].map((thing): TrackOption => {
    if (levels.length === 0 || current.includes(thing)) return { thing, allowed: true };
    const missing = notMet(thing, current, character.level);
    return missing.length > 0 ? { thing, allowed: false, notMet: missing } : { thing, allowed: true };
  });
  const unfit = list
    .filter(
      (t) => t.added && notMet(t.thing, [...new Set(levels.slice(0, t.from - 1))], t.from - 1).length > 0,
    )
    .map((t) => t.thing);
  return { choice: tracks.choice, first: levels[0] ?? null, levels: [...levels], list, options, unfit };
}

/**
 * `rankUpTo` of a pick choice (SPEC 9.3): only things up to that rank, a
 * thing without one being rank 0. It sees the character as `requires` does.
 */
function withinRank(
  pkg: ContentPackage,
  choice: PickChoice,
  scope: ExprScope,
  refs: Set<string>,
): (id: string) => boolean {
  const src = choice.options.rankUpTo;
  if (src === undefined) return () => true;
  for (const r of thingsIn(src)) refs.add(r);
  const top = evaluateNumber(src, scope);
  const things = indexes(pkg).things;
  return (id) => (things.get(id)?.rank ?? 0) <= top;
}

function isSettled(c: ChoiceState): boolean {
  return c.status === "answered" || c.status === "info" || (c.optional && c.status === "missing");
}

/** A choice worked out against the character so far, before its answer counts. */
interface Prepared {
  /** The choice id as asked: the declared id, or a copy's id. */
  id: string;
  choice: Choice;
  state: ChoiceState;
  ctx: ChoiceContext;
  hasAnswer: boolean;
  /** Picks of the answer that count for the character (pick choices). */
  counted: string[];
  /** Things not offered because a grant gives them anyway, with the thing that grants them. */
  givenLater: Map<string, string>;
}

/** Choices whose picks mark things the character has instead of giving them (`options.owned`). */
function marksOnly(choice: Choice): boolean {
  return (choice.kind === "pickOne" || choice.kind === "pickMany") && choice.options.owned === true;
}

/**
 * What a pick choice's `requires` and `recommend` see (SPEC 9.3). A pick
 * with a fixed count is made once, at the level of its step (a boon at
 * level 4): `level`, `levelOf()` and the values are those of that level,
 * so a thing that needs a higher level is not offered even if the character
 * is built at that level. `has()` and `count()` still see what the character has by the
 * time the step is asked, like the options do: a thing it gets at a later
 * level is neither offered nor recommended a second time. A pick whose
 * count is an expression or a table by level is the character's list at
 * its level (knacks that grow with the level): it sees the character at
 * its level.
 */
function pickScope(choice: Choice, character: Character, atLevel: number): ExprScope {
  const once = choice.kind === "pickOne" || (choice.kind === "pickMany" && typeof choice.count === "number");
  if (!once || atLevel >= character.level) return character.scope;
  return { ...character.scopeAt(atLevel), has: character.scope.has, count: character.scope.count };
}

/**
 * Options of a choice with `options.owned`: what the character has (picked
 * in one of `ownedFrom`, if given), whose condition holds, and that no other
 * copy of the same declared choice has marked (a repeatable thing picked
 * twice marks two different things).
 */
function ownedOptions(
  pkg: ContentPackage,
  choice: Choice,
  character: Character,
  refs: Set<string>,
  scope: ExprScope,
): string[] {
  if (choice.kind !== "pickOne" && choice.kind !== "pickMany") return [];
  const from = choice.options.ownedFrom;
  return selectThings(pkg, choice.options).flatMap((t) => {
    for (const r of thingsIn(t.requires)) refs.add(r);
    refs.add(t.id);
    const held = character.held.get(t.id);
    if (!held) return [];
    // `ownedFrom`: only what was picked in one of these choices, not what came another way.
    if (from && !(held.pickedIn !== undefined && from.includes(declaredChoiceId(held.pickedIn)))) return [];
    if (character.marks.get(t.id)?.some((c) => declaredChoiceId(c) === choice.id)) return [];
    if (t.requires !== undefined && !evaluateCondition(t.requires, scope)) return [];
    return [t.id];
  });
}

/**
 * A repeatable thing the character has is offered again only if every
 * choice with `options.owned` it grants up to the level still has something
 * to mark; otherwise its copy could never be answered. A copy picked at
 * `atLevel` is asked at that level or the grant's, whichever is higher.
 */
function canTakeAgain(
  pkg: ContentPackage,
  thing: Thing,
  character: Character,
  refs: Set<string>,
  atLevel: number,
): boolean {
  const choices = indexes(pkg).choices;
  const track = character.held.get(thing.id)?.track;
  return (thing.grants ?? []).every((g) => {
    const from = g.choice === undefined ? undefined : character.grantFrom(g, track);
    if (from === undefined) return true;
    const choice = choices.get(g.choice!);
    if (!choice || !marksOnly(choice)) return true;
    const scope = pickScope(choice, character, Math.max(atLevel, from));
    return ownedOptions(pkg, choice, character, refs, scope).length > 0;
  });
}

function prepareChoice(
  pkg: ContentPackage,
  choice: Choice,
  id: string,
  stepId: string,
  atLevel: number,
  track: string | undefined,
  doc: DraftDocument,
  character: Character,
  earlier: Record<string, ChoiceState>,
  refs: Set<string>,
  givenLater: ReadonlyMap<string, string>,
): Prepared {
  const scope = character.scope;
  const state: ChoiceState = {
    id,
    ...(id !== choice.id ? { copyOf: choice.id } : {}),
    kind: choice.kind,
    step: stepId,
    optional: choice.optional ?? false,
    status: "missing",
    atLevel,
    ...(track !== undefined ? { track } : {}),
  };
  const variant = choice.textVariants?.find((v) => evaluateCondition(v.when, scope));
  if (variant) state.textVariant = variant.id;
  const hasAnswer = Object.hasOwn(doc.answers, id) && doc.answers[id] !== null;
  if (hasAnswer) state.answer = doc.answers[id];
  const ctx: ChoiceContext = {};
  const prepared: Prepared = { id, choice, state, ctx, hasAnswer, counted: [], givenLater: new Map() };

  switch (choice.kind) {
    case "pickOne":
    case "pickMany": {
      // Offered: matches the source, its condition holds, and the character does not have it yet;
      // with `owned` the other way round: only what the character has by now, and not
      // what another copy of the same choice marked already.
      const owned = choice.options.owned ?? false;
      const at = pickScope(choice, character, atLevel);
      const ranked = withinRank(pkg, choice, at, refs);
      const options = owned
        ? ownedOptions(pkg, choice, character, refs, at).filter(ranked)
        : selectThings(pkg, choice.options).flatMap((t) => {
            for (const r of thingsIn(t.requires)) refs.add(r);
            if (character.held.has(t.id) && !(t.repeatable && canTakeAgain(pkg, t, character, refs, atLevel)))
              return [];
            if (t.requires !== undefined && !evaluateCondition(t.requires, at)) return [];
            if (!ranked(t.id)) return [];
            // A grant gives it anyway (see evaluateDraft).
            const by = givenLater.get(t.id);
            if (by !== undefined && !t.repeatable) {
              prepared.givenLater.set(t.id, by);
              return [];
            }
            return [t.id];
          });
      state.options = options;
      ctx.options = options;
      if (!owned) for (const o of options) character.offered.add(o);
      if (choice.kind === "pickMany") {
        state.count = character.amount(choice.count, character.level, track);
        state.upTo = choice.upTo ?? false;
        ctx.count = state.count;
        state.remaining = state.count;
      }
      const rec = choice.recommend?.find((r) => r.when === undefined || evaluateCondition(r.when, at));
      let recommended = rec?.pick.filter((p) => options.includes(p));
      // A count that grows with the level would need a recommendation per
      // count: the package's picks come first, the options fill up the rest.
      if (recommended && state.count !== undefined)
        recommended = [...new Set([...recommended, ...options])].slice(0, state.count);
      // A copy of an `owned` choice may have lost the package's pick to an
      // earlier copy: the first thing still free takes its place.
      else if (owned && recommended?.length === 0 && options.length > 0) recommended = [options[0]!];
      if (choice.held) {
        // Options about something the character already has are the better
        // pick; the package's own recommendation fills the remaining places.
        const things = indexes(pkg).things;
        const about = (id: string) => things.get(id)?.about;
        for (const t of selectThings(pkg, choice.options)) if (t.about !== undefined) refs.add(t.about);
        const onHand = options.filter((o) => {
          const a = about(o);
          return a !== undefined && character.held.has(a);
        });
        state.held = onHand.map((o) => about(o)!);
        if (onHand.length > 0) {
          // When more fit than are asked for, the ones the package also
          // recommends are kept: they are its pick among what the character has.
          const rec = recommended ?? [];
          const first = [...onHand.filter((o) => rec.includes(o)), ...onHand.filter((o) => !rec.includes(o))];
          const picks = [...new Set([...first, ...rec])];
          recommended = picks.slice(0, choice.kind === "pickOne" ? 1 : state.count);
        }
      }
      if (recommended) state.recommended = recommended;
      const badges: Record<string, string> = {};
      for (const b of choice.badges ?? [])
        for (const t of b.things) if (options.includes(t)) badges[t] ??= b.text;
      if (Object.keys(badges).length > 0) state.badges = badges;
      break;
    }
    case "distribute": {
      const raise = choice.methods[0]?.method === "raise" ? choice.methods[0] : undefined;
      // A raise sees the values as they are at its own level (see Character.scopeAt).
      const at = raise ? character.scopeAt(atLevel) : scope;
      const rec = choice.recommend?.find((r) => r.when === undefined || evaluateCondition(r.when, at));
      const badges: Record<string, string> = {};
      for (const b of choice.badges ?? [])
        if (b.when === undefined || evaluateCondition(b.when, at))
          for (const t of b.targets) badges[t] ??= b.text;
      if (Object.keys(badges).length > 0) state.badges = badges;
      if (raise) {
        const raiseState = raiseFor(pkg, choice.targets, raise, character, atLevel);
        state.raise = raiseState;
        ctx.raise = raiseState;
        state.remaining = raise.points;
        state.recommended = { method: 0, assign: fillRaise(choice.targets, raiseState, rec?.assign ?? {}) };
        break;
      }
      if (rec) {
        const method = choice.methods.findIndex(
          (_, i) => judgeAnswer(choice, { method: i, assign: rec.assign }, {}).status !== "invalid",
        );
        if (method >= 0) state.recommended = { method, assign: rec.assign };
      }
      const first = choice.methods[0];
      if (first?.method === "pointBuy") state.remaining = first.budget;
      break;
    }
    case "number":
      state.min = evaluateNumber(choice.min, scope);
      state.max = evaluateNumber(choice.max, scope);
      ctx.min = state.min;
      ctx.max = state.max;
      break;
    case "text":
      break;
    case "info": {
      state.status = "info";
      state.info = infoFor(pkg, choice.of, earlier, character);
      prepared.hasAnswer = false;
      break;
    }
  }
  return prepared;
}

/**
 * Judges the stored answer and gives the character what it picks. `taken`
 * (list steps) holds the picks of the step's earlier choices: picking one
 * of them again is a duplicate.
 */
function answerChoice(
  p: Prepared,
  character: Character,
  stepId: string,
  granted: Grant[],
  taken?: Set<string>,
): void {
  const { choice, state } = p;
  if (!p.hasAnswer) return;
  const ctx =
    taken && p.ctx.options ? { ...p.ctx, options: p.ctx.options.filter((o) => !taken.has(o)) } : p.ctx;
  const j = judgeAnswer(choice, state.answer, ctx);
  state.status = j.status;
  if (j.problem !== undefined) state.problem = j.problem;
  if (
    j.problem === "notOffered" &&
    taken &&
    judgeAnswer(choice, state.answer, p.ctx).problem !== "notOffered"
  )
    state.problem = "duplicate";
  if (j.problem === "notOffered" && p.givenLater.size > 0) {
    const answer = state.answer as { pick?: unknown; picks?: unknown };
    const picks = Array.isArray(answer.picks) ? answer.picks : [answer.pick];
    const givenBy = Object.fromEntries(
      picks.flatMap((id) => {
        const by = typeof id === "string" ? p.givenLater.get(id) : undefined;
        return by !== undefined ? [[id, by]] : [];
      }),
    );
    if (Object.keys(givenBy).length > 0) {
      state.problem = "duplicate";
      state.givenBy = givenBy;
    }
  }
  if (j.remaining !== undefined) state.remaining = j.remaining;
  else if (j.status !== "incomplete") delete state.remaining;
  p.counted = j.counted ?? [];
  // Picks that fit count even if others in the same answer do not; inputs only from a fitting answer.
  for (const id of p.counted) {
    taken?.add(id);
    // A pick among what the character has marks the thing; it is not given a second time.
    if (marksOnly(choice)) character.mark(id, p.id);
    else if (p.id === character.tracksChoice) character.giveTracks(id, { pickedIn: p.id }, stepId, granted);
    else character.give(id, { pickedIn: p.id }, stepId, state.atLevel, granted, 1, state.track);
  }
  if (j.status !== "invalid" && j.inputs) character.setInputs(j.inputs, p.id);
  if (j.status !== "invalid" && j.raises) character.addRaises(j.raises, p.id, state.atLevel);
}

/** What each target of a raise can take, worked out before the choice counts, at the choice's level. */
function raiseFor(
  pkg: ContentPackage,
  targets: readonly string[],
  raise: Extract<Choice, { kind: "distribute" }>["methods"][number] & { method: "raise" },
  character: Character,
  atLevel: number,
): RaiseState {
  const cap = raise.cap !== undefined ? evaluateNumber(raise.cap, character.scopeAt(atLevel)) : Infinity;
  const per = raise.maxPerTarget ?? raise.points;
  const before: Record<string, number> = {};
  const most: Record<string, number> = {};
  for (const t of targets) {
    before[t] = character.value(t, atLevel);
    const top = Math.min(cap, indexes(pkg).values.get(t)?.max ?? Infinity);
    most[t] = Math.max(0, Math.min(per, Math.floor(top - before[t])));
  }
  return { points: raise.points, before, most };
}

/**
 * A full raise for "choose for me": the package's assignment as far as it
 * fits, then the points left in the order of that assignment and of the
 * targets. Leaves points over only if no target can take more.
 */
export function fillRaise(
  targets: readonly string[],
  raise: Pick<RaiseState, "points" | "most">,
  wanted: Record<string, number>,
): Record<string, number> {
  const assign: Record<string, number> = {};
  let left = raise.points;
  const give = (t: string, n: number) => {
    const room = (raise.most[t] ?? 0) - (assign[t] ?? 0);
    const k = Math.max(0, Math.min(n, room, left));
    if (k === 0) return;
    assign[t] = (assign[t] ?? 0) + k;
    left -= k;
  };
  for (const [t, n] of Object.entries(wanted)) if (targets.includes(t)) give(t, n);
  for (const t of [...Object.keys(wanted), ...targets]) if (targets.includes(t)) give(t, left);
  return assign;
}

/** The shared list of a list step, after its answers counted. */
function poolFor(pkg: ContentPackage, prepared: Prepared[], before: HeldThing[]): PoolState {
  const picks = prepared.filter((p) => p.state.options);
  const options = [...new Set(picks.flatMap((p) => p.state.options!))];
  const slots: PoolSlot[] = picks.map((p) => ({
    count: p.state.count ?? 1,
    offers: new Set(p.state.options),
  }));
  const choices = picks.map((p, i) => ({
    choice: p.id,
    count: slots[i]!.count,
    upTo: p.state.upTo ?? false,
    options: p.state.options!,
    picks: p.counted,
    remaining: slots[i]!.count - p.counted.length,
  }));
  const all = choices.flatMap((c) => c.picks);
  const count = slots.reduce((n, s) => n + s.count, 0);
  // Picks stay with the choice they count for; an option is blocked if no
  // assignment of the picks plus this option exists.
  const keep = new Map(choices.flatMap((c, i) => c.picks.map((pick) => [pick, i] as const)));
  const blocked = options.filter((o) => !all.includes(o) && !assignPicks(slots, [...all, o], keep));
  const kinds = new Set(
    picks.flatMap((p) => selectThings(pkg, (p.choice as PickChoice).options).map((t) => t.kind)),
  );
  const recommended = picks.flatMap((p) => (Array.isArray(p.state.recommended) ? p.state.recommended : []));
  return {
    options,
    choices,
    picks: all,
    count,
    remaining: count - all.length,
    blocked,
    held: before.filter((h) => kinds.has(h.kind)),
    recommended: fillPicks(slots, [...recommended, ...options]),
  };
}

/**
 * On a list step a thing counts for one choice only (see applyChange): a
 * choice neither offers nor recommends what another choice of the list
 * holds, whichever comes first. The list itself (`pool.choices[].options`)
 * keeps the full offer, so picks can still move between the choices.
 */
function leaveToOthers(prepared: Prepared[]): void {
  for (const p of prepared) {
    const { state } = p;
    if (!state.options) continue;
    const others = new Set(prepared.filter((o) => o !== p).flatMap((o) => o.counted));
    if (others.size === 0) continue;
    const free = (id: string) => !others.has(id) || p.counted.includes(id);
    state.options = state.options.filter(free);
    if (Array.isArray(state.recommended)) {
      // A pick count is filled up from what is left, as without the list.
      let rec = state.recommended.filter(free);
      if (state.count !== undefined) rec = [...new Set([...rec, ...state.options])].slice(0, state.count);
      // A single pick whose recommendation another choice holds: the first
      // option left takes its place, so "choose for me" still has one.
      else if (rec.length === 0 && state.recommended.length > 0 && state.options.length > 0)
        rec = [state.options[0]!];
      if (rec.length > 0) state.recommended = rec;
      else delete state.recommended;
    }
    if (state.badges) for (const id of Object.keys(state.badges)) if (!free(id)) delete state.badges[id];
  }
}

function infoFor(
  pkg: ContentPackage,
  of: string,
  earlier: Record<string, ChoiceState>,
  character: Character,
): InfoContent {
  const level = character.level;
  const source = earlier[of];
  const pick =
    source?.status === "answered" ? (source.answer as { pick?: unknown } | undefined)?.pick : undefined;
  const thing = typeof pick === "string" ? pkg.things.find((t) => t.id === pick) : undefined;
  const content: InfoContent = {
    of,
    thing: thing?.id ?? null,
    things: [],
    counts: {},
    values: [],
    choices: [],
  };
  const track = thing ? character.held.get(thing.id)?.track : undefined;
  for (const g of thing?.grants ?? []) {
    if (character.grantFrom(g, track) === undefined) continue;
    if (g.thing !== undefined) {
      const had = content.things.includes(g.thing);
      if (!had) content.things.push(g.thing);
      const n = (had ? (content.counts[g.thing] ?? 1) : 0) + (g.count ?? 1);
      if (n > 1 && indexes(pkg).counted.has(g.thing)) content.counts[g.thing] = n;
    } else if (g.choice !== undefined) content.choices.push(g.choice);
    else if (g.value !== undefined) {
      const add = character.amount(g.add!, level, track);
      const existing = content.values.find((v) => v.value === g.value);
      if (existing) existing.add += add;
      else content.values.push({ value: g.value, add });
    }
  }
  // A table that gives nothing yet at this level is no gift.
  content.values = content.values.filter((v) => v.add !== 0);
  return content;
}
