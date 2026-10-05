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
  type OptionSource,
  type Thing,
} from "@builder/format/pure";
import type { DraftDocument } from "./draft.ts";
import { evaluateCondition, evaluateNumber, RuleError, type ExprScope } from "./expr.ts";
import { judgeAnswer, type ChoiceContext, type Problem } from "./judge.ts";
import { assignPicks, fillPicks, type PoolSlot } from "./pool.ts";

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
  /** Badge text key by offered option (pick choices); shown instead of "recommended". */
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
  /** Character level from which the choice is asked (the level of its step). */
  atLevel: number;
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
}

/**
 * One list of options for all choices of a step (`together: "list"`).
 * Options are offered as before the step, so every choice offers its full list;
 * a pick counts for one choice only.
 */
export interface PoolState {
  /** Every option of every choice, without things the character had before the step; in choice order, then option order. */
  options: string[];
  /** The choices, in step order: how many each takes and which picks count for it. */
  choices: { choice: string; count: number; upTo: boolean; picks: string[]; remaining: number }[];
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
  /** Step that brought it to the character. */
  step: string;
  /** Character level from which the character has it. */
  atLevel: number;
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
  /** Points added to values by `raise` answers, per value in step order, with the choice that gave them. */
  raises: Record<string, { amount: number; choice: string }[]>;
  /** Choices that still need an answer (missing, incomplete or invalid, not optional). */
  open: string[];
  complete: boolean;
  /** Choices with a stored answer that are not asked at the moment (kept for going back). */
  inactiveAnswers: string[];
}

interface Indexes {
  things: Map<string, Thing>;
  choices: Map<string, Choice>;
  values: Map<string, ContentPackage["values"][number]>;
}

const indexCache = new WeakMap<ContentPackage, Indexes>();

function indexes(pkg: ContentPackage): Indexes {
  let ix = indexCache.get(pkg);
  if (!ix) {
    ix = {
      things: new Map(pkg.things.map((t) => [t.id, t])),
      choices: new Map(pkg.flow.choices.map((c) => [c.id, c])),
      values: new Map(pkg.values.map((v) => [v.id, v])),
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
  /** Points added by raise answers, per value. */
  readonly raises = new Map<string, { amount: number; choice: string }[]>();
  private memo = new Map<string, number>();
  private computing = new Set<string>();

  private readonly pkg: ContentPackage;
  private readonly ix: Indexes;
  readonly level: number;

  constructor(pkg: ContentPackage, ix: Indexes, level: number) {
    this.pkg = pkg;
    this.ix = ix;
    this.level = level;
  }

  /**
   * Gives a thing and everything it grants up to the level; the choices
   * granted on the way are added to `choices`. `atLevel` is the level from
   * which the character has it.
   */
  give(
    id: string,
    via: { pickedIn?: string; grantedBy?: string },
    step: string,
    atLevel: number,
    choices: Grant[],
  ): void {
    const thing = this.ix.things.get(id);
    // A key that vanished from a newer package version simply stops counting.
    if (!thing) return;
    const again = this.held.has(id);
    // A thing counts once; only a repeatable one asks its choices again, once per pick.
    if (again && !thing.repeatable) return;
    if (!again) {
      this.held.set(id, { id, kind: thing.kind, ...via, step, atLevel });
      this.memo.clear();
    }
    const copy = thing.repeatable ? (via.pickedIn ?? via.grantedBy) : undefined;
    for (const g of thing.grants ?? []) {
      if ((g.atLevel ?? 1) > this.level) continue;
      const from = Math.max(atLevel, g.atLevel ?? 1);
      if (g.thing !== undefined && !again) this.give(g.thing, { grantedBy: id }, step, from, choices);
      else if (g.choice !== undefined)
        choices.push({ choice: copy ? `${g.choice}${COPY_SEPARATOR}${copy}` : g.choice, by: id, atLevel: from });
    }
  }

  addRaises(raises: Record<string, number>, choice: string): void {
    for (const [k, amount] of Object.entries(raises)) {
      if (amount === 0) continue;
      const list = this.raises.get(k) ?? [];
      list.push({ amount, choice });
      this.raises.set(k, list);
    }
    this.memo.clear();
  }

  /** A number, an expression or a table by level, worked out for this character. */
  amount(src: Amount): number {
    return typeof src === "object" ? byLevel(this.pkg, src.byLevel, this.level) : evaluateNumber(src, this.scope);
  }

  setInputs(inputs: Record<string, number>, choice: string): void {
    for (const [k, v] of Object.entries(inputs)) {
      this.inputs.set(k, v);
      this.inputChoices.set(k, choice);
    }
    this.memo.clear();
  }

  readonly scope: ExprScope = {
    value: (name) => this.value(name),
    has: (id) => this.held.has(id),
    count: (tag) => {
      let n = 0;
      for (const h of this.held.values()) if (this.ix.things.get(h.id)?.tags?.includes(tag)) n++;
      return n;
    },
  };

  value(name: string): number {
    if (name === "level") return this.level;
    const cached = this.memo.get(name);
    if (cached !== undefined) return cached;
    const def = this.ix.values.get(name);
    if (!def) throw new RuleError(`unknown value "${name}"`);
    if (this.computing.has(name)) throw new RuleError(`value "${name}" depends on itself`);
    this.computing.add(name);
    try {
      let result =
        def.formula !== undefined
          ? evaluateNumber(def.formula, this.scope)
          : def.byLevel !== undefined
            ? byLevel(this.pkg, def.byLevel, this.level)
            : (this.inputs.get(name) ?? def.default ?? 0);
      for (const h of this.held.values()) {
        for (const g of this.ix.things.get(h.id)?.grants ?? []) {
          if (g.value === name && (g.atLevel ?? 1) <= this.level) result += this.amount(g.add!);
        }
      }
      for (const r of this.raises.get(name) ?? []) result += r.amount;
      if (def.min !== undefined) result = Math.max(def.min, result);
      if (def.max !== undefined) result = Math.min(def.max, result);
      this.memo.set(name, result);
      return result;
    } finally {
      this.computing.delete(name);
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

interface Grant {
  choice: string;
  by: string;
  atLevel: number;
}

interface Gathered {
  choice: string;
  by: string[];
  atLevel: number;
}

interface PendingStep {
  id: string;
  choices: string[];
  when?: string;
  origin: "flow" | "granted";
  grantedBy: string[];
  atLevel: number;
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
  };
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
  const ix = indexes(pkg);
  /** The declared choice of an id, also of a copy. */
  const choiceOf = (id: string) => ix.choices.get(declaredChoiceId(id));
  const character = new Character(pkg, ix, doc.level);
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
          })),
        );
        continue;
      }
      step.choices = gathered.map((g) => g.choice);
      step.grantedBy = [...new Set(gathered.flatMap((g) => g.by))];
      step.atLevel = Math.min(...gathered.map((g) => g.atLevel));
    } else if (!shown) continue;

    const granted: Grant[] = [];
    const refs = new Set<string>(thingsIn(step.when));
    const before = [...character.held.values()];
    // Granted choices on a gathered step: the things that granted each one.
    const grantedByChoice = new Map((step.gather?.gathered ?? []).map((g) => [g.choice, g.by]));
    if (step.origin === "granted") grantedByChoice.set(step.id, step.grantedBy);
    const prepared: Prepared[] = [];
    const atLevelOf = new Map((step.gather?.gathered ?? []).map((g) => [g.choice, g.atLevel]));
    for (const choiceId of step.choices) {
      const choice = choiceOf(choiceId);
      if (!choice) continue;
      const at = atLevelOf.get(choiceId) ?? step.atLevel;
      const p = prepareChoice(pkg, choice, choiceId, step.id, at, doc, character, choices, refs);
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
    });

    // SPEC 9.4: one step per newly granted choice, right after this step, in
    // grant order; a choice with a gather group whose step is still ahead waits there.
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
      if (gatherStep) gatherStep.gather!.gathered.push({ choice: g.choice, by: [g.by], atLevel: g.atLevel });
      else
        inserted.push({
          id: g.choice,
          choices: [g.choice],
          origin: "granted",
          grantedBy: [g.by],
          atLevel: g.atLevel,
        });
    }
    queue.unshift(...inserted);
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
  return {
    level: doc.level,
    steps,
    choices,
    things: [...character.held.values()],
    values: character.allValues(),
    inputs: Object.fromEntries(
      [...character.inputs].map(([k, amount]) => [k, { amount, choice: character.inputChoices.get(k)! }]),
    ),
    raises: Object.fromEntries(character.raises),
    open,
    complete: open.length === 0,
    inactiveAnswers: Object.keys(doc.answers).filter((k) => !(k in choices)),
  };
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
}

function prepareChoice(
  pkg: ContentPackage,
  choice: Choice,
  id: string,
  stepId: string,
  atLevel: number,
  doc: DraftDocument,
  character: Character,
  earlier: Record<string, ChoiceState>,
  refs: Set<string>,
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
  };
  const variant = choice.textVariants?.find((v) => evaluateCondition(v.when, scope));
  if (variant) state.textVariant = variant.id;
  const hasAnswer = Object.hasOwn(doc.answers, id) && doc.answers[id] !== null;
  if (hasAnswer) state.answer = doc.answers[id];
  const ctx: ChoiceContext = {};
  const prepared: Prepared = { id, choice, state, ctx, hasAnswer, counted: [] };

  switch (choice.kind) {
    case "pickOne":
    case "pickMany": {
      // Offered: matches the source, its condition holds, and the character does not have it yet.
      const options: string[] = [];
      for (const t of selectThings(pkg, choice.options)) {
        for (const r of thingsIn(t.requires)) refs.add(r);
        if (character.held.has(t.id) && !t.repeatable) continue;
        if (t.requires !== undefined && !evaluateCondition(t.requires, scope)) continue;
        options.push(t.id);
      }
      state.options = options;
      ctx.options = options;
      if (choice.kind === "pickMany") {
        state.count = character.amount(choice.count);
        state.upTo = choice.upTo ?? false;
        ctx.count = state.count;
        state.remaining = state.count;
      }
      const rec = choice.recommend?.find((r) => r.when === undefined || evaluateCondition(r.when, scope));
      let recommended = rec?.pick.filter((p) => options.includes(p));
      // A count that grows with the level would need a recommendation per
      // count: the package's picks come first, the options fill up the rest.
      if (recommended && state.count !== undefined)
        recommended = [...new Set([...recommended, ...options])].slice(0, state.count);
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
      const rec = choice.recommend?.find((r) => r.when === undefined || evaluateCondition(r.when, scope));
      const raise = choice.methods[0]?.method === "raise" ? choice.methods[0] : undefined;
      if (raise) {
        const raiseState = raiseFor(pkg, choice.targets, raise, character);
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
  if (j.remaining !== undefined) state.remaining = j.remaining;
  else if (j.status !== "incomplete") delete state.remaining;
  p.counted = j.counted ?? [];
  // Picks that fit count even if others in the same answer do not; inputs only from a fitting answer.
  for (const id of p.counted) {
    taken?.add(id);
    character.give(id, { pickedIn: p.id }, stepId, state.atLevel, granted);
  }
  if (j.status !== "invalid" && j.inputs) character.setInputs(j.inputs, p.id);
  if (j.status !== "invalid" && j.raises) character.addRaises(j.raises, p.id);
}

/** What each target of a raise can take, worked out before the choice counts. */
function raiseFor(
  pkg: ContentPackage,
  targets: readonly string[],
  raise: Extract<Choice, { kind: "distribute" }>["methods"][number] & { method: "raise" },
  character: Character,
): RaiseState {
  const cap = raise.cap !== undefined ? evaluateNumber(raise.cap, character.scope) : Infinity;
  const per = raise.maxPerTarget ?? raise.points;
  const before: Record<string, number> = {};
  const most: Record<string, number> = {};
  for (const t of targets) {
    before[t] = character.value(t);
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
  const content: InfoContent = { of, thing: thing?.id ?? null, things: [], values: [], choices: [] };
  for (const g of thing?.grants ?? []) {
    if ((g.atLevel ?? 1) > level) continue;
    if (g.thing !== undefined) content.things.push(g.thing);
    else if (g.choice !== undefined) content.choices.push(g.choice);
    else if (g.value !== undefined) {
      const add = character.amount(g.add!);
      const existing = content.values.find((v) => v.value === g.value);
      if (existing) existing.add += add;
      else content.values.push({ value: g.value, add });
    }
  }
  // A table that gives nothing yet at this level is no gift.
  content.values = content.values.filter((v) => v.add !== 0);
  return content;
}
