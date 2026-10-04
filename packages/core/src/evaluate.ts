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
  parseExpr,
  type Choice,
  type ContentPackage,
  type OptionSource,
  type Thing,
} from "@builder/format/pure";
import type { DraftDocument } from "./draft.ts";
import { evaluateCondition, evaluateNumber, RuleError, type ExprScope } from "./expr.ts";
import { judgeAnswer, type ChoiceContext, type Problem } from "./judge.ts";

export type ChoiceStatus = "answered" | "incomplete" | "missing" | "invalid" | "info";

export interface ChoiceState {
  id: string;
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
   * option is `about`, in option order. Those options come first in `recommended`.
   */
  held?: string[];
  /** For `info` choices: what the thing picked in choice `of` gives at this level. */
  info?: InfoContent;
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
}

export interface Evaluation {
  level: number;
  steps: StepState[];
  choices: Record<string, ChoiceState>;
  /** Everything the character has, in the order it was gained. */
  things: HeldThing[];
  values: Record<string, number>;
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

  /** Gives a thing and everything it grants up to the level. Returns the choices granted on the way. */
  give(id: string, via: { pickedIn?: string; grantedBy?: string }, step: string, choices: Grant[]): void {
    if (this.held.has(id)) return;
    const thing = this.ix.things.get(id);
    // A key that vanished from a newer package version simply stops counting.
    if (!thing) return;
    this.held.set(id, { id, kind: thing.kind, ...via, step });
    this.memo.clear();
    for (const g of thing.grants ?? []) {
      if ((g.atLevel ?? 1) > this.level) continue;
      if (g.thing !== undefined) this.give(g.thing, { grantedBy: id }, step, choices);
      else if (g.choice !== undefined) choices.push({ choice: g.choice, by: id });
    }
  }

  setInputs(inputs: Record<string, number>): void {
    for (const [k, v] of Object.entries(inputs)) this.inputs.set(k, v);
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
          : (this.inputs.get(name) ?? def.default ?? 0);
      for (const h of this.held.values()) {
        for (const g of this.ix.things.get(h.id)?.grants ?? []) {
          if (g.value === name && (g.atLevel ?? 1) <= this.level) {
            result += evaluateNumber(g.add!, this.scope);
          }
        }
      }
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

interface Grant {
  choice: string;
  by: string;
}

interface PendingStep {
  id: string;
  choices: string[];
  when?: string;
  origin: "flow" | "granted";
  grantedBy: string[];
}

/** Things matching an option source, in package order. */
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
  const character = new Character(pkg, ix, doc.level);
  const choices: Record<string, ChoiceState> = {};
  const steps: StepState[] = [];
  const scheduled = new Set<string>();

  const queue: PendingStep[] = pkg.flow.steps.map((s) => ({
    id: s.id,
    choices: s.choices,
    ...(s.when !== undefined ? { when: s.when } : {}),
    origin: "flow",
    grantedBy: [],
  }));
  for (const s of pkg.flow.steps) for (const c of s.choices) scheduled.add(c);

  while (queue.length > 0) {
    const step = queue.shift()!;
    if (step.when !== undefined && !evaluateCondition(step.when, character.scope)) continue;

    const granted: Grant[] = [];
    const refs = new Set<string>(thingsIn(step.when));
    for (const choiceId of step.choices) {
      const choice = ix.choices.get(choiceId);
      if (!choice) continue;
      choices[choiceId] = evaluateChoice(pkg, choice, step.id, doc, character, choices, granted, refs);
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
    });

    // SPEC 9.4: one step per newly granted choice, right after this step, in grant order.
    const inserted: PendingStep[] = [];
    for (const g of granted) {
      const existing = inserted.find((p) => p.id === g.choice);
      if (existing) {
        existing.grantedBy.push(g.by);
        continue;
      }
      if (scheduled.has(g.choice)) continue;
      scheduled.add(g.choice);
      inserted.push({ id: g.choice, choices: [g.choice], origin: "granted", grantedBy: [g.by] });
    }
    queue.unshift(...inserted);
  }

  // An info step shows what the thing gives the finished character: a grant's
  // formula may use a value set by a later step (scores picked after the
  // calling), so it is worked out again once every step has been walked.
  for (const state of Object.values(choices)) {
    const choice = ix.choices.get(state.id);
    if (choice?.kind === "info" && state.info)
      state.info = infoFor(pkg, choice.of, choices, character.level, character.scope);
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
    open,
    complete: open.length === 0,
    inactiveAnswers: Object.keys(doc.answers).filter((k) => !(k in choices)),
  };
}

function isSettled(c: ChoiceState): boolean {
  return c.status === "answered" || c.status === "info" || (c.optional && c.status === "missing");
}

function evaluateChoice(
  pkg: ContentPackage,
  choice: Choice,
  stepId: string,
  doc: DraftDocument,
  character: Character,
  earlier: Record<string, ChoiceState>,
  granted: Grant[],
  refs: Set<string>,
): ChoiceState {
  const scope = character.scope;
  const state: ChoiceState = {
    id: choice.id,
    kind: choice.kind,
    step: stepId,
    optional: choice.optional ?? false,
    status: "missing",
  };
  const hasAnswer = Object.hasOwn(doc.answers, choice.id) && doc.answers[choice.id] !== null;
  if (hasAnswer) state.answer = doc.answers[choice.id];
  const ctx: ChoiceContext = {};

  switch (choice.kind) {
    case "pickOne":
    case "pickMany": {
      // Offered: matches the source, its condition holds, and the character does not have it yet.
      const options: string[] = [];
      for (const t of selectThings(pkg, choice.options)) {
        for (const r of thingsIn(t.requires)) refs.add(r);
        if (character.held.has(t.id)) continue;
        if (t.requires !== undefined && !evaluateCondition(t.requires, scope)) continue;
        options.push(t.id);
      }
      state.options = options;
      ctx.options = options;
      if (choice.kind === "pickMany") {
        state.count = evaluateNumber(choice.count, scope);
        state.upTo = choice.upTo ?? false;
        ctx.count = state.count;
        state.remaining = state.count;
      }
      const rec = choice.recommend?.find((r) => r.when === undefined || evaluateCondition(r.when, scope));
      let recommended = rec?.pick.filter((p) => options.includes(p));
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
          const picks = [...new Set([...onHand, ...(recommended ?? [])])];
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
      state.info = infoFor(pkg, choice.of, earlier, character.level, scope);
      return state;
    }
  }

  if (!hasAnswer) return state;
  const j = judgeAnswer(choice, state.answer, ctx);
  state.status = j.status;
  if (j.problem !== undefined) state.problem = j.problem;
  if (j.remaining !== undefined) state.remaining = j.remaining;
  else if (j.status !== "incomplete") delete state.remaining;
  // Picks that fit count even if others in the same answer do not; inputs only from a fitting answer.
  for (const id of j.counted ?? []) character.give(id, { pickedIn: choice.id }, stepId, granted);
  if (j.status !== "invalid" && j.inputs) character.setInputs(j.inputs);
  return state;
}

function infoFor(
  pkg: ContentPackage,
  of: string,
  earlier: Record<string, ChoiceState>,
  level: number,
  scope: ExprScope,
): InfoContent {
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
      const add = evaluateNumber(g.add!, scope);
      const existing = content.values.find((v) => v.value === g.value);
      if (existing) existing.add += add;
      else content.values.push({ value: g.value, add });
    }
  }
  return content;
}
