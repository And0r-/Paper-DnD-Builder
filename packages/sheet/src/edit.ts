/**
 * Changing a sheet model like a printed page, and reading the play state
 * against it. A kept copy takes any text anywhere and rows added or
 * crossed out; nothing follows from a change and no rule is checked.
 * Plain data in, plain data out: the screen, tests and later readers share
 * these functions.
 */
import type { FeatureRow, SheetModel, SheetSection } from "./model.ts";
import type { PlayValue } from "./play.ts";

/** Where a text sits in the model: keys and indexes from the model's root. */
export type ModelPath = readonly (string | number)[];

/** The text at `path`, or undefined where there is none. */
export function textAt(model: SheetModel, path: ModelPath): string | undefined {
  let at: unknown = model;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return typeof at === "string" ? at : undefined;
}

/**
 * The model with the text at `path` replaced. Only an existing text can be
 * changed: a path to anything else (a number, a list, nothing) leaves the
 * model as it is, so a change can never break its shape.
 */
export function withText(model: SheetModel, path: ModelPath, text: string): SheetModel {
  if (path.length === 0 || textAt(model, path) === undefined) return model;
  const put = (at: unknown, depth: number): unknown => {
    const key = path[depth]!;
    if (depth === path.length - 1) {
      if (Array.isArray(at)) return at.map((v, i) => (i === key ? text : v));
      return { ...(at as object), [key]: text };
    }
    if (Array.isArray(at)) return at.map((v, i) => (i === key ? put(v, depth + 1) : v));
    const o = at as Record<string, unknown>;
    return { ...o, [key]: put(o[key as string], depth + 1) };
  };
  return put(model, 0) as SheetModel;
}

/** Section kinds that have rows to write in and cross out. */
export const ROW_KINDS = ["list", "statTable", "featureTable"] as const;
export type RowSection = Extract<SheetSection, { kind: (typeof ROW_KINDS)[number] }>;

export function hasRows(s: SheetSection): s is RowSection {
  return (ROW_KINDS as readonly string[]).includes(s.kind);
}

/** How many rows a section has; 0 for a section without rows. */
export function rowCount(s: SheetSection): number {
  switch (s.kind) {
    case "list":
      return s.items.length;
    case "statTable":
    case "featureTable":
      return s.rows.length;
    default:
      return 0;
  }
}

function withSection(model: SheetModel, index: number, next: SheetSection): SheetModel {
  return { ...model, sections: model.sections.map((s, i) => (i === index ? next : s)) };
}

/** An id for a row written in by hand: never a package key, and unique in the section. */
function ownRowId(rows: readonly FeatureRow[]): string {
  const taken = new Set(rows.map((r) => r.id));
  let n = rows.length + 1;
  while (taken.has(`own-${n}`)) n++;
  return `own-${n}`;
}

/**
 * The model with an empty row at the end of section `index` (a list item,
 * a table row with every cell empty, a feature row without uses). A row
 * written in by hand belongs to the last group, like a line added at the
 * bottom of the page.
 */
export function withRowAdded(model: SheetModel, index: number): SheetModel {
  const s = model.sections[index];
  if (!s) return model;
  switch (s.kind) {
    case "list":
      return withSection(model, index, { ...s, items: [...s.items, ""] });
    case "statTable":
      return withSection(model, index, {
        ...s,
        rows: [...s.rows, { name: "", cells: s.columns.map(() => "") }],
      });
    case "featureTable":
      return withSection(model, index, {
        ...s,
        rows: [
          ...s.rows,
          {
            id: ownRowId(s.rows),
            name: "",
            marks: "",
            text: "",
            uses: null,
            // The player's own: under no heading of the package, after all of them.
            group: null,
          },
        ],
      });
    default:
      return model;
  }
}

/** The model without row `row` of section `index`. */
export function withRowRemoved(model: SheetModel, index: number, row: number): SheetModel {
  const s = model.sections[index];
  if (!s) return model;
  switch (s.kind) {
    case "list":
      return withSection(model, index, { ...s, items: s.items.filter((_, i) => i !== row) });
    case "statTable":
      return withSection(model, index, { ...s, rows: s.rows.filter((_, i) => i !== row) });
    case "featureTable":
      return withSection(model, index, { ...s, rows: s.rows.filter((_, i) => i !== row) });
    default:
      return model;
  }
}

// --------------------------------------------------------------- play state

/** How a place on the sheet is filled in at the table. */
export type PlayField =
  { id: string; kind: "ticks"; max: number } | { id: string; kind: "pencil" } | { id: string; kind: "text" };

/**
 * Every place a player writes or ticks on the sheet, in the order of the
 * sheet, with what it takes: ticks (circles, squares, use boxes) up to the
 * number printed, a number written in pencil, or text (a name, blank lines,
 * notes). Cards are not on the screen sheet.
 */
export function playFields(model: Pick<SheetModel, "sections">): PlayField[] {
  const out: PlayField[] = [];
  for (const s of model.sections) {
    switch (s.kind) {
      case "header":
        if (s.playedByField) out.push({ id: s.playedByField, kind: "text" });
        break;
      case "statBoxes":
        for (const b of s.boxes) {
          if (!b.field) continue;
          if (b.style === "circles") out.push({ id: b.field, kind: "ticks", max: b.circles });
          else if (b.style === "boxes") out.push({ id: b.field, kind: "ticks", max: b.squares });
          else out.push({ id: b.field, kind: "pencil" });
        }
        break;
      case "checkList":
        for (const i of s.items) if (i.field) out.push({ id: i.field, kind: "pencil" });
        break;
      case "featureTable":
        for (const r of s.rows) {
          if (!r.usesField || r.uses === null) continue;
          if ("boxes" in r.uses) out.push({ id: r.usesField, kind: "ticks", max: r.uses.boxes });
          else if ("count" in r.uses) out.push({ id: r.usesField, kind: "pencil" });
        }
        break;
      case "list":
      case "notes":
        if (s.field) out.push({ id: s.field, kind: "text" });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Ticks of a stored value, cut to what the field holds; 0 for anything else. */
export function ticksOf(value: PlayValue | undefined, max: number): number {
  if (typeof value !== "object" || value === null) return 0;
  return Math.max(0, Math.min(max, value.checks));
}

/** A written value as text; ticks are not text. */
export function writtenOf(value: PlayValue | undefined): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

/**
 * What the shown sheet makes of the stored play state: only its own
 * fields, ticks cut to what each holds, a value of the wrong sort left
 * out. The stored state itself is never trimmed: another version of the
 * sheet may have room for what this one skips.
 */
export function shownState(
  model: Pick<SheetModel, "sections">,
  state: Readonly<Record<string, PlayValue>>,
): Record<string, PlayValue> {
  const out: Record<string, PlayValue> = {};
  for (const f of playFields(model)) {
    const v = state[f.id];
    if (v === undefined) continue;
    if (f.kind === "ticks") {
      const n = ticksOf(v, f.max);
      if (typeof v === "object" && n > 0) out[f.id] = { checks: n };
    } else if (typeof v !== "object") {
      out[f.id] = v;
    }
  }
  return out;
}

/**
 * A text written in pencil as it is stored: a whole number as a number, so
 * the PDF can print it as one; anything else as the text, trimmed. Empty
 * means "rubbed out" (undefined).
 */
export function pencilValue(text: string): PlayValue | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  return /^-?\d{1,9}$/.test(t) ? Number(t) : t;
}

/** Ticking box `i` (0-based) of a row of ticks: the first `i + 1` are ticked, or `i` if it was the last one ticked. */
export function tickAt(ticked: number, i: number): number {
  return ticked === i + 1 ? i : i + 1;
}
