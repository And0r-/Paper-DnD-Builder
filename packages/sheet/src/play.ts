/**
 * The play state: what is written and rubbed out at the table, by field id
 * (`sheetFields`). A number or a text to write in, or how many marks are
 * ticked. One per character, for the original and every copy alike; a
 * sheet without a field skips it, and ticks beyond what a field holds are
 * cut when shown. The state itself is never trimmed.
 */
import type { FeatureRow, SheetModel } from "./model.ts";

export type PlayValue = number | string | { checks: number };
export type PlayState = Readonly<Record<string, PlayValue>>;

/**
 * The play state with every card's use boxes as the sheet has them: the
 * screen ticks the sheet's row of a thing, the card of the same thing shows
 * the same. A card's own entry, or a row with other boxes, is left alone.
 */
export function withCardsAsSheet(model: SheetModel, play: PlayState): PlayState {
  const rows = new Map<string, FeatureRow>();
  for (const s of model.sections)
    if (s.kind === "featureTable")
      for (const r of s.rows) if (r.usesField && !rows.has(r.id)) rows.set(r.id, r);
  let out: Record<string, PlayValue> | null = null;
  for (const c of model.cards) {
    const r = rows.get(c.id);
    if (!c.usesField || !r?.usesField || play[c.usesField] !== undefined) continue;
    const value = play[r.usesField];
    if (value === undefined || JSON.stringify(r.uses) !== JSON.stringify(c.uses)) continue;
    (out ??= { ...play })[c.usesField] = value;
  }
  return out ?? play;
}
