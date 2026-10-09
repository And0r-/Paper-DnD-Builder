/**
 * The shape of a sheet model, as a Zod schema. The model's types are
 * inferred from it, so a stored copy of a sheet is checked against exactly
 * what `buildSheetModel` makes. Everything here is plain JSON: strings,
 * numbers, booleans; dates as ISO 8601 strings.
 */
import { z } from "zod";

const text = z.string();
const count = z.number().int().min(0);

/**
 * Where something is written or ticked on paper (pencil box, squares,
 * circles, use boxes, notes, blank lines). Made of package keys (section,
 * value, thing) only, so the same place keeps its id when the character
 * goes up a level; later the play state hangs on it.
 */
export const fieldIdSchema = z.string().min(1);

/**
 * Use boxes (SPEC 13 `uses`): n boxes to tick, a word like "always", or nothing.
 * More than MAX_USE_BOXES do not fit a row: then the number is printed with a field to write what is left.
 */
export const usesSchema = z
  .union([
    z.strictObject({ boxes: z.number().int().min(1) }),
    z.strictObject({ count: z.number().int().min(1) }),
    z.strictObject({ text }),
  ])
  .nullable();

export const statBoxSchema = z.strictObject({
  /** The value the box shows (package key). */
  valueId: z.string(),
  label: text,
  style: z.enum(["number", "pencil", "circles", "boxes"]),
  /** The big number, with unit if it has one ("9 m"), or the box's own text ("5 × d10"); "" for none. */
  text,
  /** Circles to tick (`circles`). */
  circles: count,
  /** Squares to tick (`boxes`). */
  squares: count,
  hint: text,
  /**
   * Where a printed number comes from, as for a check ("Grace +3 · Keen
   * Senses +2"); "" for none. Missing in copies kept before it was added.
   */
  parts: text.optional(),
  /** Where the player writes or ticks (`pencil`, `circles`, `boxes`); none for a printed number. */
  field: fieldIdSchema.optional(),
});

/** A number on paper and, small under it, where it comes from ("Grace +2 · Practice +2"); "" if nothing to say. */
export const figureSchema = z.strictObject({ text, parts: text });

/** A group of rows under one heading (`byRank`, `groupBy`): rows of the same group follow each other. */
export const rowGroupSchema = z.strictObject({ key: z.string(), title: text, hint: text });

export const featureRowSchema = z.strictObject({
  /** The thing of the row (package key). */
  id: z.string(),
  name: text,
  /** The row's mark signs, in the package's order, joined by spaces; "" for none. */
  marks: text,
  /** The `note` stat, small under the name; "" for none. */
  note: text.optional(),
  text,
  uses: usesSchema,
  /** Field of the use boxes, if the row has boxes or a number to count down. */
  usesField: fieldIdSchema.optional(),
  group: rowGroupSchema.nullable(),
});

const sectionBase = {
  id: z.string(),
  span: z.number().int().min(1),
  /** The package sets this section apart (format `apart`); only some designs show it so. */
  apart: z.boolean().optional(),
  title: text,
  hint: text,
};

export const sheetSectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...sectionBase,
    kind: z.literal("header"),
    name: text,
    summary: text,
    packageName: text,
    /** Answers under the summary line ("Folk: Fenfolk"); empty text for an open choice. */
    fields: z.array(z.strictObject({ label: text, text })),
    /** Where the player's own name is written by hand. */
    playedByField: fieldIdSchema.optional(),
  }),
  z.strictObject({ ...sectionBase, kind: z.literal("statBoxes"), boxes: z.array(statBoxSchema) }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("scoreColumn"),
    scores: z.array(
      z.strictObject({
        /** The score's value (package key). */
        valueId: z.string(),
        label: text,
        value: text,
        /** The value made from the score (package key). */
        derivedId: z.string().optional(),
        derivedLabel: text,
        derived: text.nullable(),
        /** A further number made with the score, small beside it. */
        extra: z.strictObject({ label: text, value: text }).nullable().optional(),
      }),
    ),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("checkList"),
    /**
     * `total`: the number in the box; empty text for a box to fill in by hand (then `field`).
     * `strong`: marked a second time (a thing of the section's `strong` is about it).
     */
    items: z.array(
      z.strictObject({
        id: z.string(),
        name: text,
        marked: z.boolean(),
        strong: z.boolean().optional(),
        note: text,
        total: figureSchema,
        field: fieldIdSchema.optional(),
      }),
    ),
    /** What ◉ means (`strongLegend`), if a row is marked twice; else empty. */
    legend: z.array(text),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("statTable"),
    columns: z.array(text),
    /** Per column: text that takes the room left and wraps. */
    wrap: z.array(z.boolean()).optional(),
    rows: z.array(z.strictObject({ name: text, cells: z.array(text) })),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("featureTable"),
    /** Sentences above the rows (`lead`). */
    lead: z.array(text),
    rows: z.array(featureRowSchema),
    /** What the marks on the rows mean: "C = …", one entry per mark that is on a row. */
    legend: z.array(text),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("list"),
    items: z.array(text),
    /** A small line under each item, "" for none; as long as `items`. Missing: no lines (format 0.22). */
    details: z.array(text).optional(),
    blankLines: count,
    /** The blank lines, written on by hand. */
    field: fieldIdSchema.optional(),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("answers"),
    rows: z.array(z.strictObject({ label: text, text })),
  }),
  z.strictObject({ ...sectionBase, kind: z.literal("helpBox"), paragraphs: z.array(text) }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("notes"),
    lines: count,
    field: fieldIdSchema.optional(),
  }),
]);

export const cardSchema = z.strictObject({
  /** The thing of the card (package key). */
  id: z.string(),
  typeLine: text,
  name: text,
  fields: z.array(z.strictObject({ label: text, value: text })),
  /** The line of the card layout's `origins` that matches where the character got the thing; none matches, none. */
  origin: z.strictObject({ label: text, value: text }).optional(),
  table: text,
  rules: z.array(text),
  uses: usesSchema,
  usesField: fieldIdSchema.optional(),
  /** The kind's hint (`card.<kind>.hint`), printed above the footer of every card; "" for none. */
  hint: text,
});

/** One value of the character: its words and the labelled values that change with it ("These depend on it: …"). */
export const sheetValueSchema = z.strictObject({
  id: z.string(),
  label: text,
  text,
  dependents: z.array(z.strictObject({ id: z.string(), label: text })),
});

/** The full text of one thing on the sheet or a card: its rules text and its explanation, each as paragraphs. */
export const rulesEntrySchema = z.strictObject({
  id: z.string(),
  name: text,
  /** The kind's name ("Knack"). */
  kindName: text,
  rules: z.array(text),
  explain: z.array(text),
});

/** Rules texts that came with one thing (a calling, a folk) or a thing on its own. */
export const rulesGroupSchema = z.strictObject({
  /** The thing they came with (package key). */
  origin: z.string(),
  title: text,
  entries: z.array(rulesEntrySchema),
});

const isoDate = z.iso.datetime();

/**
 * Which sheet this is: the original, made from the character as it is now,
 * or a copy the player kept. The original says when the character last
 * changed and from which package version; a copy keeps both of the
 * original it was made from. Any difference means "the original changed
 * since", without comparing two models.
 */
export const sheetOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("original"),
    level: z.number().int(),
    builtAt: isoDate,
    packageVersion: z.string(),
    /** When the character last changed in the builder; absent where nobody stores it (a test sheet). */
    changedAt: isoDate.optional(),
  }),
  z.strictObject({
    kind: z.literal("copy"),
    name: z.string(),
    createdAt: isoDate,
    fromLevel: z.number().int(),
    fromPackageVersion: z.string(),
    fromChangedAt: isoDate.optional(),
  }),
]);

export const sheetModelSchema = z.strictObject({
  /** Version of this shape; bumped when a stored copy would no longer read the same. */
  version: z.literal(1),
  language: z.string(),
  origin: sheetOriginSchema,
  packageId: z.string(),
  name: text,
  level: z.number().int(),
  /** "Stufe 3" / "Level 3". */
  levelLabel: text,
  packageName: text,
  /** Unit per dimension the sheet is written in. */
  units: z.record(z.string(), z.string()),
  /** "Einheiten: Meter, Kilogramm". */
  unitsLine: text,
  attribution: text,
  /** The date of `origin`, formatted for the footer in the sheet's language. */
  createdOn: text,
  /** In the package's order, conditions applied. */
  sections: z.array(sheetSectionSchema),
  cards: z.array(cardSchema),
  values: z.array(sheetValueSchema),
  rulesTexts: z.array(rulesGroupSchema),
});
