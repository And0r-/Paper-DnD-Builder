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

/** The change from `before` to `after`, or null if the same steps stand in both. */
export function stepChange(before: readonly FlowEntry[], after: readonly FlowEntry[]): StepChange | null {
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
  if (added.size === 0 && gone.length === 0) return null;
  return { added, gone };
}
