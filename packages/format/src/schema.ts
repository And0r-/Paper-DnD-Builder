/**
 * Zod schemas for every file of a content package (structure only).
 *
 * These schemas check the shape of each file on its own. Cross-file rules
 * (references resolve, texts complete, unit tables cover every amount, ...)
 * live in validate.ts. SPEC.md is the human-readable description of both.
 */
import { z } from "zod";

// ---------------------------------------------------------------- identifiers

/** Stable, language-independent key of a thing, choice, step, glossary entry, ... */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
/** Key of a value; usable as a name inside expressions. */
export const VALUE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
/** Key of a text inside texts/<lang>/*.json. */
export const TEXT_KEY_PATTERN = /^[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/;
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
export const UNIT_PATTERN = /^[a-z][a-z0-9]*$/;

export const id = z
  .string()
  .regex(ID_PATTERN, 'must be lowercase words joined by "-" and ".", e.g. "calling.lamplighter"');
export const valueId = z
  .string()
  .regex(
    VALUE_ID_PATTERN,
    'must start with a lowercase letter and contain only letters and digits, e.g. "mightBonus"',
  )
  .refine((v) => v !== "level", { message: '"level" is built in and cannot be declared' });
export const textKey = z.string().regex(TEXT_KEY_PATTERN, 'must look like "group.some-name.field"');
export const language = z
  .string()
  .regex(LANGUAGE_PATTERN, 'must be a language code like "de", "en" or "pt-BR"');
export const unitId = z.string().regex(UNIT_PATTERN, 'must be a short lowercase unit key like "ft" or "m"');
/** An expression string; parsed and checked in validate.ts. */
export const expr = z.string().min(1, "expression must not be empty");
const level = z.number().int().min(1);

/**
 * A number per character level: entry 0 applies at `flow.level.min`, the
 * last at `flow.level.max` (the validator checks the length). For tables
 * like "slots per level" that would be long `if()` chains as a formula.
 */
export const byLevelSchema = z.strictObject({ byLevel: z.array(z.number()).min(1) });
/** A number, an expression or a table by level. */
export const amountSchema = z.union([z.number(), expr, byLevelSchema]);
const span = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);

// ------------------------------------------------------------------ manifest

export const licenseSchema = z.strictObject({
  /** Human-readable name, e.g. "Creative Commons Attribution 4.0". Not shown to players. */
  name: z.string().min(1),
  /** SPDX identifier if one exists, e.g. "CC-BY-4.0". */
  spdx: z.string().min(1).optional(),
  url: z.url().optional(),
  /** May content under this license be distributed publicly? */
  publishable: z.boolean(),
});

export const sourceSchema = z.strictObject({
  title: z.string().min(1),
  url: z.url().optional(),
  version: z.string().min(1).optional(),
  /** Date the source was retrieved, YYYY-MM-DD. */
  retrieved: z.iso.date().optional(),
  /** Default license of entries from this source (key into `licenses`). */
  license: id,
});

export const manifestSchema = z.strictObject({
  /** Format version this package is written against, "MAJOR.MINOR". */
  formatVersion: z.string().regex(/^\d+\.\d+$/, 'must be "MAJOR.MINOR", e.g. "0.1"'),
  /** Package key. Also the folder name when mounted. Never changes. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words joined by "-"'),
  /** Version of the package content (semantic versioning). */
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'must be semantic, e.g. "1.0.0"'),
  /** Languages this package ships texts for. Each needs texts/<lang>/. */
  languages: z.array(language).min(1),
  /** Categories of things. The builder does not interpret them; they group things and select cards. */
  kinds: z.array(id).min(1),
  sources: z.record(id, sourceSchema).refine((r) => Object.keys(r).length > 0, "declare at least one source"),
  licenses: z
    .record(id, licenseSchema)
    .refine((r) => Object.keys(r).length > 0, "declare at least one license"),
});

// --------------------------------------------------------------------- units

export const unitsSchema = z.strictObject({
  /** A dimension groups interchangeable units, e.g. "length": ft, m. */
  dimensions: z.record(
    id,
    z.strictObject({
      /** Unit amounts in texts (`{{length:30}}`) are written in. */
      source: unitId,
      units: z.array(unitId).min(1),
    }),
  ),
  /** Suggested unit per dimension for a new account, by language. */
  languageDefaults: z.record(language, z.record(id, unitId)),
  conversions: z.array(
    z.strictObject({
      from: unitId,
      to: unitId,
      /** Exact display values: [fromAmount, toAmount]. */
      table: z.array(z.tuple([z.number(), z.number()])).min(1),
      /** Optional rule for amounts not in the table: amount * factor, rounded to the nearest `step`. */
      fallback: z.strictObject({ factor: z.number().positive(), step: z.number().positive() }).optional(),
    }),
  ),
});

export const quantitySchema = z.strictObject({ amount: z.number(), unit: unitId });

// -------------------------------------------------------------------- values

export const valueSchema = z
  .strictObject({
    id: valueId,
    source: id,
    license: id.optional(),
    /** Unit of the value, if it is a quantity. Amounts are in this unit. */
    unit: unitId.optional(),
    /** Starting value if neither a formula nor an input sets it. Default 0. */
    default: z.number().optional(),
    /** Expression computing the value before modifiers are added. */
    formula: expr.optional(),
    /** The value before modifiers, one number per character level (like a formula). */
    byLevel: z.array(z.number()).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((v) => [v.formula, v.default, v.byLevel].filter((x) => x !== undefined).length <= 1, {
    message: "use only one of formula, default and byLevel",
  });

export const valuesSchema = z.array(valueSchema);

// -------------------------------------------------------------------- things

export const grantSchema = z
  .strictObject({
    /** Give the character this thing. */
    thing: id.optional(),
    /** How many of the thing (with "thing"), e.g. 8 arrows. Default 1. Counts of the same thing add up. */
    count: z.number().int().min(1).optional(),
    /** Ask the player this choice (inserted as a step). */
    choice: id.optional(),
    /** Add to this value ... */
    value: valueId.optional(),
    /** ... this number, expression or table by level. */
    add: amountSchema.optional(),
    /** Character level from which the grant applies. Default 1. */
    atLevel: level.optional(),
  })
  .superRefine((g, ctx) => {
    const set = [g.thing, g.choice, g.value].filter((x) => x !== undefined).length;
    if (set !== 1) {
      ctx.addIssue({ code: "custom", message: 'a grant needs exactly one of "thing", "choice" or "value"' });
    }
    if (g.value !== undefined && g.add === undefined) {
      ctx.addIssue({ code: "custom", message: 'a value grant needs "add"', path: ["add"] });
    }
    if (g.value === undefined && g.add !== undefined) {
      ctx.addIssue({ code: "custom", message: '"add" only goes with "value"', path: ["add"] });
    }
    if (g.thing === undefined && g.count !== undefined) {
      ctx.addIssue({ code: "custom", message: '"count" only goes with "thing"', path: ["count"] });
    }
  });

/** A text filled with character values: `{{var:<name>}}` takes the value with this id. */
const filledText = z.strictObject({
  text: textKey,
  vars: z.record(z.string().regex(VALUE_ID_PATTERN), z.string().min(1)).optional(),
});

export const statValueSchema = z.union(
  [
    z.number(),
    z.boolean(),
    quantitySchema,
    filledText,
    /** The character's value with this key, e.g. uses that grow with the level. */
    z.strictObject({ value: z.string().min(1) }),
  ],
  {
    error:
      'must be a number, true/false, {"amount": n, "unit": "u"}, {"text": "text.key", "vars"?: {…}} or {"value": "valueKey"}',
  },
);

export const thingSchema = z.strictObject({
  id,
  kind: id,
  source: id,
  license: id.optional(),
  /** Rank of the thing itself (not the character level), shown on cards. */
  rank: z.number().int().min(0).optional(),
  /** Display group inside long option lists. Texts: group.<group>.name */
  group: id.optional(),
  tags: z.array(id).optional(),
  /** Condition under which the thing may be chosen. */
  requires: expr.optional(),
  /** Fixed facts shown on cards and in the "learn more" panel. Labels: stat.<key>.name */
  stats: z.record(z.string().regex(VALUE_ID_PATTERN, "stat keys are camelCase"), statValueSchema).optional(),
  grants: z.array(grantSchema).optional(),
  /** Another thing this one is about, e.g. a skill with one tool is about that tool. See choice `held`. */
  about: id.optional(),
  /** Print a card for this thing (layout from sheet.json "cards" by kind). */
  card: z.boolean().optional(),
  /**
   * May be picked again in another choice although the character has it.
   * Each pick asks the choices it grants anew, as copies `<choice>@<where picked>`.
   */
  repeatable: z.boolean().optional(),
});

export const thingsFileSchema = z.array(thingSchema);

// ---------------------------------------------------------------------- flow

const optionSourceShape = {
  kind: id.optional(),
  /** Every listed tag must be present on the thing. */
  tags: z.array(id).optional(),
  ids: z.array(id).optional(),
};
const selectsSomething = [
  (o: { kind?: string | undefined; tags?: string[] | undefined; ids?: string[] | undefined }) =>
    o.kind !== undefined || o.ids !== undefined || o.tags !== undefined,
  { message: 'select options with "kind", "tags" or "ids"' },
] as const;

export const optionSourceSchema = z.strictObject(optionSourceShape).refine(...selectsSomething);

/**
 * Options of a pick choice. With `owned`, only things the character already
 * has are offered, and a pick marks the thing instead of giving it again.
 * `ownedFrom` narrows that to things picked in one of these choices.
 */
export const choiceOptionsSchema = z
  .strictObject({
    ...optionSourceShape,
    owned: z.boolean().optional(),
    ownedFrom: z.array(id).min(1).optional(),
  })
  .refine(...selectsSomething)
  .refine((o) => o.ownedFrom === undefined || o.owned === true, {
    message: '"ownedFrom" narrows "owned": set "owned": true',
    path: ["ownedFrom"],
  });

const choiceBase = {
  id,
  source: id,
  license: id.optional(),
  /** Player may finish the character without answering. */
  optional: z.boolean().optional(),
  /**
   * Other texts while a condition holds. The first entry whose `when` is true
   * is the active variant; its texts are `choice.<choice>.variant.<id>.*`.
   */
  textVariants: z
    .array(z.strictObject({ id, when: expr }))
    .min(1)
    .optional(),
  /**
   * Group this choice is gathered in when a thing grants it: it is asked at
   * the flow step with the same `gather` instead of right after the granting step.
   */
  gather: id.optional(),
};

const pickRecommendation = z.strictObject({ when: expr.optional(), pick: z.array(id).min(1) });

/** A short label (text key) shown on the listed options, e.g. how hard they are to play. */
const badge = z.strictObject({ things: z.array(id).min(1), text: textKey });

/** A short label (text key) on rows of a distribute choice. */
const targetBadge = z.strictObject({
  when: expr.optional(),
  targets: z.array(valueId).min(1),
  text: textKey,
});

/**
 * Prefer options whose `about` thing the character already has: they are
 * recommended first, and `text` (with {{var:things}}) names those things above the list.
 */
const held = z.strictObject({ text: textKey });

export const pointBuySchema = z.strictObject({
  method: z.literal("pointBuy"),
  budget: z.number().int().positive(),
  /** Total cost of reaching each score, by score. Lowest key is the start value. */
  costs: z.record(z.string().regex(/^-?\d+$/, "keys are whole numbers"), z.number().int().min(0)),
});

export const arraySchema = z.strictObject({
  method: z.literal("array"),
  /** Fixed numbers, each assigned to one target. */
  values: z.array(z.number().int()).min(1),
});

/**
 * Adds points on top of the targets' current values (not their base):
 * `points` in all, at most `maxPerTarget` on one target, no target above `cap`.
 */
export const raiseSchema = z.strictObject({
  method: z.literal("raise"),
  points: z.number().int().positive(),
  /** Default: `points`. */
  maxPerTarget: z.number().int().positive().optional(),
  /** Highest value a target may reach with these points: a number or an expression. */
  cap: z.union([z.number(), expr]).optional(),
});

export const choiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...choiceBase,
    kind: z.literal("pickOne"),
    options: choiceOptionsSchema,
    recommend: z.array(pickRecommendation).optional(),
    /** Shown on an option instead of the "recommended" badge. At most one per thing. */
    badges: z.array(badge).optional(),
    held: held.optional(),
  }),
  z.strictObject({
    ...choiceBase,
    kind: z.literal("pickMany"),
    options: choiceOptionsSchema,
    /** How many to pick: a number, an expression or a table by level. */
    count: z.union([
      z.number().int().positive(),
      expr,
      z.strictObject({ byLevel: z.array(z.number().int().positive()).min(1) }),
    ]),
    /** If true, up to `count`; otherwise exactly `count`. */
    upTo: z.boolean().optional(),
    recommend: z.array(pickRecommendation).optional(),
    badges: z.array(badge).optional(),
    held: held.optional(),
  }),
  z.strictObject({
    ...choiceBase,
    kind: z.literal("distribute"),
    targets: z.array(valueId).min(1),
    methods: z.array(z.discriminatedUnion("method", [pointBuySchema, arraySchema, raiseSchema])).min(1),
    recommend: z
      .array(z.strictObject({ when: expr.optional(), assign: z.record(valueId, z.number().int()) }))
      .optional(),
    /**
     * A short label on the rows of the listed targets while `when` holds, e.g.
     * which values matter most for the character. The first badge that holds wins.
     * Each row may also say in a sentence what its value does: the text
     * `choice.<choice>.target.<target>` (or the active text variant's
     * `choice.<choice>.variant.<id>.target.<target>`).
     */
    badges: z.array(targetBadge).optional(),
  }),
  z.strictObject({
    ...choiceBase,
    kind: z.literal("number"),
    /** The value the answer is stored in. */
    target: valueId,
    min: z.union([z.number(), expr]),
    max: z.union([z.number(), expr]),
    default: z.number().optional(),
  }),
  z.strictObject({
    ...choiceBase,
    kind: z.literal("text"),
    maxLength: z.number().int().positive(),
    multiline: z.boolean().optional(),
    /** Text key whose value is a list of suggestions ("roll a suggestion"). */
    suggestions: textKey.optional(),
  }),
  z.strictObject({
    ...choiceBase,
    kind: z.literal("info"),
    /** Show what the option picked in this pickOne choice grants. */
    of: id,
  }),
]);

/**
 * Choices granted by a repeatable thing are asked once per pick of it, as
 * copies with the id `<choice>@<where the thing was picked>`. A copy uses
 * the declared choice's rules and texts.
 */
export const COPY_SEPARATOR = "@";

/** The declared choice of a choice id: itself, or for a copy the choice it copies. */
export function declaredChoiceId(id: string): string {
  const i = id.indexOf(COPY_SEPARATOR);
  return i < 0 ? id : id.slice(0, i);
}

export const fixedStepSchema = z.strictObject({
  id,
  /** Choices shown on this step. More than one only for small related questions. */
  choices: z.array(id).min(1),
  /** Step is shown only while this expression is true. */
  when: expr.optional(),
});

/** A place in the flow where granted choices with the same `gather` group are asked. */
export const gatherStepSchema = z.strictObject({
  id,
  gather: id,
  /**
   * Missing: each gathered choice is its own step here. `sections`: one step
   * with all of them. `list`: one step with one shared list of options.
   */
  together: z.enum(["sections", "list"]).optional(),
  when: expr.optional(),
});

export const flowSchema = z.strictObject({
  level: z
    .strictObject({ min: level, max: level, default: level })
    .refine((l) => l.min <= l.default && l.default <= l.max, { message: "need min <= default <= max" }),
  steps: z.array(z.union([fixedStepSchema, gatherStepSchema])).min(1),
  choices: z.array(choiceSchema).min(1),
  /** The text choice whose answer is the character's name. */
  characterName: id,
  summary: z.strictObject({
    /** Values shown large on the overview screen. */
    fields: z.array(valueId),
    /** Arguments for the summary.line text, by {{var:name}}. */
    line: z.record(
      z.string().regex(VALUE_ID_PATTERN),
      z.union([z.strictObject({ choice: id }), z.strictObject({ value: z.string() })]),
    ),
  }),
});

// --------------------------------------------------------------------- sheet

const sectionBase = {
  id,
  span,
  /** Section is printed only while this expression is true (title included). */
  when: expr.optional(),
};
const statKey = z.string().regex(VALUE_ID_PATTERN, "stat keys are camelCase");

/**
 * What a row's thing must match for a mark. `tags`: the thing carries them
 * all. `how`: it was picked in a choice or granted by another thing. `from`:
 * the thing behind it (the thing that granted it, or that granted the choice
 * it was picked in) is one of these. `pickedIn`: it was picked in one of these
 * choices. `marked`: one of these choices with `options.owned` marked it.
 * `unmarked`: at least one of these was asked, and none marked it.
 */
const markConditionShape = {
  tags: z.array(id).min(1).optional(),
  how: z.enum(["picked", "granted"]).optional(),
  from: optionSourceSchema.optional(),
  pickedIn: z.array(id).min(1).optional(),
  marked: z.array(id).min(1).optional(),
  unmarked: z.array(id).min(1).optional(),
};
const conditionFields = Object.keys(markConditionShape) as (keyof typeof markConditionShape)[];
const hasCondition = [
  (m: Partial<Record<keyof typeof markConditionShape, unknown>>) =>
    conditionFields.some((k) => m[k] !== undefined),
  { message: `a mark needs one of ${conditionFields.map((k) => `"${k}"`).join(", ")}` },
] as const;

/** A sign on rows of a `featureTable`; `not`: rows that also match this get no sign. */
export const markSchema = z
  .strictObject({
    /** The sign, a letter or two. */
    text: textKey,
    /** What the sign means, in the legend under the table. */
    legend: textKey,
    ...markConditionShape,
    not: z
      .strictObject(markConditionShape)
      .refine(...hasCondition)
      .optional(),
  })
  .refine(...hasCondition);

export const sectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...sectionBase,
    kind: z.literal("header"),
    /** Answers printed small under the summary line, each with a label (default: the choice's title). */
    fields: z
      .array(z.strictObject({ choice: id, label: textKey.optional() }))
      .min(1)
      .max(4)
      .optional(),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("statBoxes"),
    boxes: z
      .array(
        z.strictObject({
          value: z.string(),
          /** `boxes`: as many squares to tick as the value, no number (`text` may say what they are). */
          style: z.enum(["number", "pencil", "circles", "boxes"]),
          /** Text key printed as the box label instead of `value.<value>.name`, e.g. a shorter word. */
          label: textKey.optional(),
          /** Printed large instead of the number, filled with character values, e.g. "5 × d10". */
          text: filledText.optional(),
          /** Box is printed only while this expression is true; the other boxes close up. */
          when: expr.optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("scoreColumn"),
    scores: z
      .array(
        z.strictObject({
          value: valueId,
          derived: valueId.optional(),
          /** A further number made with this score, printed small with its sign next to it. */
          extra: valueId.optional(),
          /** Label of `extra` (text key); default `value.<extra>.name`. */
          extraLabel: textKey.optional(),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("checkList"),
    things: optionSourceSchema,
    /** Stat shown small next to each name (for example the score a skill is rolled with). */
    note: statKey.optional(),
    /** Stat naming a value ({"value": …}) printed in the box, with where it comes from. */
    total: statKey.optional(),
    /**
     * Held things selected here mark the thing they are `about` a second time
     * (printed ◉ instead of ●), e.g. a talent the character is especially good at.
     */
    strong: optionSourceSchema.optional(),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("featureTable"),
    things: optionSourceSchema,
    /** Stat that gives the use boxes: a whole number n draws n boxes, a {text} stat prints the text. */
    uses: statKey.optional(),
    /** Rows grouped by the things' `rank`, lowest first, each group under its rank's name. */
    byRank: z.boolean().optional(),
    /**
     * Short signs next to a row's name, explained in a legend under the table.
     * A mark is on every row whose thing matches all its fields.
     */
    marks: z.array(markSchema).min(1).optional(),
    /** A sentence above the rows per held thing selected by `things`: the text `<thing>.<text>`, if it exists. */
    lead: z.strictObject({ things: optionSourceSchema, text: textKey }).optional(),
    /** Stat printed small under the name, as in a checkList. */
    note: statKey.optional(),
    /** `origin`: rows grouped under the name of what brought them, e.g. a calling or a folk. */
    groupBy: z.literal("origin").optional(),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("statTable"),
    things: optionSourceSchema,
    /**
     * One column per stat, after the name. `signed`: numbers with their sign ("+5").
     * `wrap`: a text column that takes the room left and wraps, e.g. a list of properties.
     */
    columns: z
      .array(z.strictObject({ stat: statKey, signed: z.boolean().optional(), wrap: z.boolean().optional() }))
      .min(1)
      .max(4),
  }),
  z.strictObject({
    ...sectionBase,
    kind: z.literal("list"),
    things: optionSourceSchema,
    blankLines: z.number().int().min(0),
  }),
  z.strictObject({ ...sectionBase, kind: z.literal("answers"), choices: z.array(id).min(1) }),
  z.strictObject({ ...sectionBase, kind: z.literal("helpBox") }),
  z.strictObject({ ...sectionBase, kind: z.literal("notes"), lines: z.number().int().min(1) }),
]);

export const sheetSchema = z.strictObject({
  sections: z.array(sectionSchema).min(1),
  /** Card layout per thing kind. */
  cards: z.record(
    id,
    z.strictObject({
      /** Exactly four stat keys for the 2x2 grid on the card. */
      fields: z.tuple([z.string(), z.string(), z.string(), z.string()]),
      /** Stat that gives the use boxes in the card footer, as in featureTable. */
      uses: statKey.optional(),
    }),
  ),
});

// ------------------------------------------------------------------ glossary

export const glossarySchema = z.array(z.strictObject({ id, source: id, license: id.optional() }));

// --------------------------------------------------------------------- texts

/** A text: a string, a list of strings, or null for "known missing, not translated yet". */
export const textValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1), z.null()]);

export const textsFileSchema = z.strictObject({
  /** Where the texts in this file come from. One file per source and language. */
  source: id,
  license: id.optional(),
  entries: z.record(textKey, textValueSchema),
});

// --------------------------------------------------------------------- types

export type License = z.infer<typeof licenseSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Units = z.infer<typeof unitsSchema>;
export type Quantity = z.infer<typeof quantitySchema>;
export type Value = z.infer<typeof valueSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type ByLevel = z.infer<typeof byLevelSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type StatValue = z.infer<typeof statValueSchema>;
export type Thing = z.infer<typeof thingSchema>;
export type OptionSource = z.infer<typeof optionSourceSchema>;
export type ChoiceOptions = z.infer<typeof choiceOptionsSchema>;
export type Choice = z.infer<typeof choiceSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Step = Flow["steps"][number];
export type FixedStep = z.infer<typeof fixedStepSchema>;
export type GatherStep = z.infer<typeof gatherStepSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Mark = z.infer<typeof markSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type GlossaryEntry = z.infer<typeof glossarySchema>[number];
export type TextValue = z.infer<typeof textValueSchema>;
export type TextsFile = z.infer<typeof textsFileSchema>;
