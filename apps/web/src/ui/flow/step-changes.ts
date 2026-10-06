/**
 * What an answer did to the list of steps, for the step list to show it
 * (AND-96): steps that came in green for a moment, steps that went in red
 * and then gone. The list itself says it; no sentence above the question.
 */
import type { FlowEntry } from "./model.ts";

/** An entry that went, kept for a moment at the place it had. */
export interface GoneEntry {
  key: string;
  title: string;
  /**
   * True when its whole step went: it stands among the steps. Else it was a
   * part of a step that stays (`section`) and stands among that step's parts.
   */
  whole: boolean;
  /** Key of the step it belongs to in the list as it is now (whole steps: the step it follows). */
  section: string | undefined;
  /** Key of the entry it followed that is still there; undefined at the top of its list. */
  after: string | undefined;
}

export interface StepChange {
  /** Entries that came, or that ask more than before (a gathered step got a choice). */
  added: ReadonlySet<string>;
  gone: GoneEntry[];
}

/** What tells one list of steps from another: the entries, and how much each asks. */
export function stepsSignature(entries: readonly FlowEntry[]): string {
  return entries.map((e) => `${e.key}:${e.choices.length}`).join("|");
}

/**
 * Whether the parts of a step are worth a mark, given its first entry and
 * the side it stands on: parts a step without an answer has only by its
 * suggestion are not (AND-100).
 */
export type PartsAsked = (head: FlowEntry, side: "before" | "after") => boolean;

/**
 * Parts are worth a mark once the player answered their step, or when the
 * step gathers its parts by level (it has a name of its own).
 */
export function answeredParts(answers: {
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
}): PartsAsked {
  return (head, side) =>
    head.sectionTitle !== undefined || head.choices.some((c) => answers[side][c] !== undefined);
}

/** The change from `before` to `after`, or null if the same steps stand in both. */
export function stepChange(
  before: readonly FlowEntry[],
  after: readonly FlowEntry[],
  asked: PartsAsked = () => true,
): StepChange | null {
  const was = new Map(before.map((e) => [e.key, e]));
  const now = new Map(after.map((e) => [e.key, e]));
  const added = new Set(
    after
      .filter((e) => {
        const old = was.get(e.key);
        return !old || e.choices.length > old.choices.length;
      })
      .map((e) => e.key),
  );
  const gone: GoneEntry[] = [];
  const goneSections = new Set<number>();
  for (const [i, e] of before.entries()) {
    if (now.has(e.key)) continue;
    const kin = before.filter((x) => x.section === e.section);
    const stays = kin.find((x) => now.has(x.key));
    // The nearest entry before it that is still there.
    const prev = before
      .slice(0, i)
      .reverse()
      .find((x) => now.has(x.key));
    if (!stays) {
      // A whole step went: one line for it, under its own name.
      if (goneSections.has(e.section)) continue;
      goneSections.add(e.section);
      const anchor = prev && now.get(prev.key)!.sectionKey;
      gone.push({
        key: e.key,
        title: e.sectionTitle ?? e.title,
        whole: true,
        section: anchor,
        after: anchor,
      });
      continue;
    }
    const section = now.get(stays.key)!.sectionKey;
    const inSection = prev && now.get(prev.key)!.sectionKey === section ? prev.key : undefined;
    gone.push({ key: e.key, title: e.title, whole: false, section, after: inSection });
  }
  // Sections of `after` that stand for a step that went under the same name.
  const paired = new Set<number>();
  const left: GoneEntry[] = [];
  for (const g of gone) {
    const twin = sameTitle(g, after, was, added);
    if (!twin) {
      left.push(g);
      continue;
    }
    if (!g.whole) {
      added.delete(twin.key);
      continue;
    }
    // The step stays to the player; what it asks is told part by part, by name (AND-138).
    paired.add(twin.section);
    const old = before.filter((x) => x.section === was.get(g.key)!.section);
    const fresh = after.filter((x) => x.section === twin.section);
    left.push(...partsBetween(old, fresh, added));
  }
  // Parts of a step the player has not answered come and go with the suggestion: not marked.
  for (const key of added) {
    const e = now.get(key)!;
    const head = after.find((x) => x.section === e.section)!;
    if ((was.has(head.key) || paired.has(e.section)) && !asked(head, "after")) added.delete(key);
  }
  const shown = left.filter((g) => {
    if (g.whole) return true;
    const head = before.find((x) => x.section === was.get(g.key)!.section)!;
    return asked(head, "before");
  });
  if (added.size === 0 && shown.length === 0) return null;
  return { added, gone: shown };
}

/**
 * A step that went and one that came under the same name are, to the
 * player, the same step: neither is shown as gone or new (AND-100). The
 * package may give it another key (each choice its own), the name stays.
 * A whole step pairs with a whole step that came; a part with a part that
 * came in the same step. Returns the entry that came for `g` (for a whole
 * step, its first entry), if it has one.
 */
function sameTitle(
  g: GoneEntry,
  after: readonly FlowEntry[],
  was: ReadonlyMap<string, FlowEntry>,
  added: ReadonlySet<string>,
): FlowEntry | undefined {
  const fresh = (e: FlowEntry) => added.has(e.key) && !was.has(e.key);
  if (!g.whole) {
    return after.find((e) => fresh(e) && e.part > 1 && e.sectionKey === g.section && e.title === g.title);
  }
  return after.find(
    (e) =>
      e.part === 1 &&
      fresh(e) &&
      (e.sectionTitle ?? e.title) === g.title &&
      after.filter((x) => x.section === e.section).every((x) => !was.has(x.key)),
  );
}

/**
 * The parts of a step that went (`old`) and came back under the same name
 * (`fresh`), told apart by name: a part whose name both have is the same
 * part and is taken out of `added`; a part only `old` has went, and stays
 * in the step at the place it had. A group "Your way" of two parts that
 * comes back with one has lost the other (AND-138).
 */
function partsBetween(
  old: readonly FlowEntry[],
  fresh: readonly FlowEntry[],
  added: Set<string>,
): GoneEntry[] {
  const left = [...fresh];
  const section = fresh[0]!.sectionKey;
  const out: GoneEntry[] = [];
  // The part that came for the last old part that stays, to stand behind.
  let prev: string | undefined;
  for (const e of old) {
    const i = left.findIndex((x) => x.title === e.title);
    if (i >= 0) {
      prev = left[i]!.key;
      added.delete(prev);
      left.splice(i, 1);
      continue;
    }
    out.push({ key: e.key, title: e.title, whole: false, section, after: prev });
  }
  return out;
}
