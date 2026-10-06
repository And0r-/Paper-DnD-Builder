/**
 * The play state: what is written and rubbed out at the table, by field id
 * (`sheetFields`). A number or a text to write in, or how many marks are
 * ticked. One per character, for the original and every copy alike; a
 * sheet without a field skips it, and ticks beyond what a field holds are
 * cut when shown. The state itself is never trimmed.
 */
export type PlayValue = number | string | { checks: number };
export type PlayState = Readonly<Record<string, PlayValue>>;
