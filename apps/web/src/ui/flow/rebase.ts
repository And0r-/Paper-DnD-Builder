/**
 * Changes of this window that are not saved yet, and how they go on top of
 * a newer state of the server (AND-270).
 *
 * Every change remembers what the window showed before it (`base`). Before
 * it is sent, and whenever the server's state moved on because of someone
 * else, it is compared with what the server holds now:
 *
 * - The server still holds the base: nobody else touched it; it is sent.
 * - Someone else changed the same thing: the stored one counts, ours gives
 *   way (AND-258).
 * - Numbers spread over several values (`distribute`, such as scores) count
 *   value by value: only the values this window changed are sent, on top of
 *   the server's. A value someone else set meanwhile stays theirs; ours to
 *   other values of the same question are saved alongside.
 *
 * So a window that comes back after a while without a connection never
 * sends back its old copy of what others changed meanwhile.
 */
import type { DistributeAnswer, DraftChange, DraftDocument } from "@builder/core";

export type Pending =
  | { type: "setLevel"; level: number; base: number }
  | { type: "answer"; choice: string; answer: unknown; base: unknown }
  /** Some values of a distribute answer, keeping its way (`method`); null takes one out. */
  | {
      type: "assign";
      choice: string;
      method: number;
      assign: Record<string, number | null>;
      base: Record<string, number>;
    }
  /** `base`: the answers of the step's choices before. */
  | { type: "pool"; step: string; picks: string[]; base: Record<string, unknown> }
  /** The track of each level from 2 on; `base`: the tracks before. */
  | { type: "tracks"; tracks: string[]; base: string[] };

/** What a newer state of the server did to a change still on its way. */
export interface Rebased {
  /** What is still to send; null when nothing is left. */
  next: Pending | null;
  /** Someone else changed what this change changes: theirs counts. */
  gaveWay: boolean;
  /** Values of the same question someone else set meanwhile, kept next to ours. */
  alongside: Record<string, number>;
}

function isDistribute(a: unknown): a is DistributeAnswer {
  if (typeof a !== "object" || a === null) return false;
  const d = a as Partial<DistributeAnswer>;
  return typeof d.method === "number" && typeof d.assign === "object" && d.assign !== null;
}

/** Equal as data: the database may give keys back in another order. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => same(x, bb[i]));
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/**
 * The change as it waits to be sent, made on `doc` (what the window showed).
 * `poolChoices`: the choices of a pool change's step.
 */
export function pendingOf(c: DraftChange, doc: DraftDocument, poolChoices: readonly string[] = []): Pending {
  switch (c.type) {
    case "setLevel":
      return { type: "setLevel", level: c.level, base: doc.level };
    case "tracks":
      return { type: "tracks", tracks: c.tracks, base: doc.tracks ?? [] };
    case "pool":
      return {
        type: "pool",
        step: c.step,
        picks: c.picks,
        base: Object.fromEntries(poolChoices.map((ch) => [ch, doc.answers[ch]])),
      };
    case "answer": {
      const before = doc.answers[c.choice];
      if (isDistribute(c.answer) && isDistribute(before) && c.answer.method === before.method) {
        const keys = new Set([...Object.keys(before.assign), ...Object.keys(c.answer.assign)]);
        const assign: Record<string, number | null> = {};
        for (const k of keys) {
          const now = c.answer.assign[k] ?? null;
          if (now !== (before.assign[k] ?? null)) assign[k] = now;
        }
        return {
          type: "assign",
          choice: c.choice,
          method: before.method,
          assign,
          base: { ...before.assign },
        };
      }
      return { type: "answer", choice: c.choice, answer: c.answer, base: before };
    }
  }
}

/** Two changes of the same thing: only one needs to be sent. */
export function sameTarget(a: Pending, b: Pending): boolean {
  if (a.type === "setLevel") return b.type === "setLevel";
  if (a.type === "tracks") return b.type === "tracks";
  if (a.type === "pool") return b.type === "pool" && a.step === b.step;
  return (b.type === "answer" || b.type === "assign") && a.choice === b.choice;
}

/** A pending answer as a whole, on top of what the server holds. */
function whole(p: Extract<Pending, { type: "answer" | "assign" }>): { answer: unknown; base: unknown } {
  if (p.type === "answer") return { answer: p.answer, base: p.base };
  return {
    answer: { method: p.method, assign: put(p.base, p.assign) },
    base: { method: p.method, assign: p.base },
  };
}

function put(assign: Record<string, number>, changes: Record<string, number | null>): Record<string, number> {
  const out = { ...assign };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * `older` and `newer` (same target, see {@link sameTarget}) as one change:
 * what `newer` sets, on the base of `older`, which the server is still at.
 */
export function combine(older: Pending, newer: Pending): Pending {
  if (older.type === "assign" && newer.type === "assign" && older.method === newer.method) {
    return { ...newer, assign: { ...older.assign, ...newer.assign }, base: older.base };
  }
  if (
    (older.type === "answer" || older.type === "assign") &&
    (newer.type === "answer" || newer.type === "assign")
  ) {
    return { type: "answer", choice: newer.choice, answer: whole(newer).answer, base: whole(older).base };
  }
  return { ...newer, base: older.base } as Pending;
}

/** `p` on top of `doc`, the server's state (or what it will be once the changes before `p` are saved). */
export function rebase(p: Pending, doc: DraftDocument): Rebased {
  const keep: Rebased = { next: p, gaveWay: false, alongside: {} };
  const drop = (gaveWay: boolean): Rebased => ({ next: null, gaveWay, alongside: {} });
  switch (p.type) {
    case "setLevel":
      if (doc.level === p.level) return drop(false);
      return doc.level === p.base ? keep : drop(true);
    case "tracks": {
      const now = doc.tracks ?? [];
      if (same(now, p.tracks)) return drop(false);
      return same(now, p.base) ? keep : drop(true);
    }
    case "answer": {
      const now = doc.answers[p.choice];
      if (same(now, p.answer)) return drop(false);
      return same(now, p.base) ? keep : drop(true);
    }
    case "pool":
      return Object.entries(p.base).every(([ch, a]) => same(doc.answers[ch], a)) ? keep : drop(true);
    case "assign": {
      const now = doc.answers[p.choice];
      if (!isDistribute(now) || now.method !== p.method) return drop(!same(now, whole(p).base));
      const assign: Record<string, number | null> = {};
      let gaveWay = false;
      for (const [k, v] of Object.entries(p.assign)) {
        const there = now.assign[k] ?? null;
        if (there === v) continue;
        // Someone else set this value meanwhile: theirs counts.
        if (there !== (p.base[k] ?? null)) gaveWay = true;
        else assign[k] = v;
      }
      const alongside: Record<string, number> = {};
      for (const [k, v] of Object.entries(now.assign)) {
        if (!(k in p.assign) && v !== p.base[k]) alongside[k] = v;
      }
      if (Object.keys(assign).length === 0) return { next: null, gaveWay, alongside };
      return { next: { ...p, assign, base: { ...now.assign } }, gaveWay, alongside };
    }
  }
}

/** The change to send for `p` on top of `doc`; call {@link rebase} first. */
export function toChange(p: Pending, doc: DraftDocument): DraftChange {
  switch (p.type) {
    case "setLevel":
      return { type: "setLevel", level: p.level };
    case "tracks":
      return { type: "tracks", tracks: p.tracks };
    case "pool":
      return { type: "pool", step: p.step, picks: p.picks };
    case "answer":
      return { type: "answer", choice: p.choice, answer: p.answer };
    case "assign": {
      const now = doc.answers[p.choice];
      const from = isDistribute(now) && now.method === p.method ? now.assign : p.base;
      return { type: "answer", choice: p.choice, answer: { method: p.method, assign: put(from, p.assign) } };
    }
  }
}

/** A whole queue on top of a newer state; see {@link rebaseQueue}. */
export interface QueueRebased {
  queue: Pending[];
  /** What the window shows: the state with the queue on top. */
  doc: DraftDocument;
  gaveWay: boolean;
  /** The first question where someone else set values next to ours. */
  alongside: { choice: string; values: Record<string, number> } | null;
  /** The first question that changed under ours (gave way or alongside). */
  choice: string | null;
}

/**
 * The queue on top of `doc`, one change after another. The first `from`
 * are on their way already: they stay as they are (the server answers
 * them), but count for what comes after them and for what is said.
 */
export function rebaseQueue(
  queue: readonly Pending[],
  doc: DraftDocument,
  from: number,
  apply: (doc: DraftDocument, c: DraftChange) => DraftDocument,
): QueueRebased {
  const out: QueueRebased = { queue: [], doc, gaveWay: false, alongside: null, choice: null };
  queue.forEach((p, i) => {
    const r = rebase(p, out.doc);
    if (i < from) out.queue.push(p);
    else if (r.next) out.queue.push(r.next);
    const values = Object.keys(r.alongside).length > 0 ? r.alongside : null;
    if (r.gaveWay) out.gaveWay = true;
    if (values && !out.alongside && p.type === "assign") out.alongside = { choice: p.choice, values };
    if (
      (r.gaveWay || values) &&
      out.choice === null &&
      p.type !== "setLevel" &&
      p.type !== "pool" &&
      p.type !== "tracks"
    )
      out.choice = p.choice;
    if (r.next) out.doc = apply(out.doc, toChange(r.next, out.doc));
  });
  return out;
}
