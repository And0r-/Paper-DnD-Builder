/**
 * What goes on paper, in one language and one set of units.
 *
 * `buildPrintModel` turns a package, a draft and the reader's settings into
 * plain strings and numbers: every text is looked up in the reader's
 * language, every quantity converted by the package's tables. The layout
 * (render.ts) only places what is here; it never looks at the package. So
 * "no other language on the page" is decided in this one file.
 */
import {
  evaluateCondition,
  evaluateDraft,
  evaluationScope,
  effectiveUnits,
  formatMeasure,
  renderText,
  selectThings,
  summarize,
  type DraftDocument,
  type Evaluation,
  type MeasureContext,
} from "@builder/core";
import type { ContentPackage, Section, StatValue, Thing } from "@builder/format/pure";
import { isCard } from "./cards.ts";
import { MESSAGES, type Messages } from "./messages.ts";

export interface PrintSettings {
  language: string;
  /** Unit per dimension from the account; missing dimensions follow the language. */
  units?: Readonly<Record<string, string>>;
  /** Date printed in the footer and stored in the PDF. */
  createdAt?: Date;
}

export interface StatBox {
  label: string;
  style: "number" | "pencil" | "circles";
  /** The big number, with unit if it has one ("9 m"). */
  text: string;
  /** Circles to tick (`circles`). */
  circles: number;
  hint: string;
}

/** Use boxes (SPEC 13 `uses`): n boxes to tick, a word like "always", or nothing. */
export type Uses = { boxes: number } | { text: string } | null;

export type SheetSection = { id: string; span: number; title: string; hint: string } & (
  | { kind: "header"; name: string; summary: string; packageName: string }
  | { kind: "statBoxes"; boxes: StatBox[] }
  | {
      kind: "scoreColumn";
      scores: { label: string; value: string; derivedLabel: string; derived: string | null }[];
    }
  | { kind: "checkList"; items: { name: string; marked: boolean; note: string }[] }
  | { kind: "featureTable"; rows: { name: string; text: string; uses: Uses }[] }
  | { kind: "list"; items: string[]; blankLines: number }
  | { kind: "answers"; rows: { label: string; text: string }[] }
  | { kind: "helpBox"; paragraphs: string[] }
  | { kind: "notes"; lines: number }
);

export interface Card {
  typeLine: string;
  name: string;
  fields: { label: string; value: string }[];
  table: string;
  rules: string[];
  uses: Uses;
}

export interface PrintModel {
  language: string;
  messages: Messages;
  name: string;
  /** "Stufe 3" / "Level 3". */
  levelLabel: string;
  packageName: string;
  /** "Einheiten: Meter, Kilogramm". */
  unitsLine: string;
  attribution: string;
  createdAt: Date;
  /** Formatted for the footer, in the reader's language. */
  createdOn: string;
  sections: SheetSection[];
  cards: Card[];
}

export class PrintError extends Error {
  readonly code: "languageNotSupported";
  constructor(code: "languageNotSupported", message: string) {
    super(message);
    this.code = code;
  }
}

/** Languages that write ordinal numbers with a dot ("1." = "first"). */
const ORDINAL_DOT = new Set([
  "cs",
  "da",
  "de",
  "et",
  "fi",
  "hr",
  "hu",
  "is",
  "lv",
  "nb",
  "nn",
  "no",
  "pl",
  "sk",
  "sl",
  "sr",
  "tr",
]);

/**
 * The text up to the first full stop, question or exclamation mark that ends
 * a sentence. A dot after a single letter ("z. B.") does not end one, nor,
 * in languages that write ordinals with a dot, one after a number ("des 1.
 * Grades").
 */
export function firstSentence(s: string, language: string): string {
  const ordinals = ORDINAL_DOT.has(language.split("-")[0]!);
  const end = ordinals
    ? /^.*?(?<!(?:^|[\s(])(?:\d+|\p{L}))[.!?](?=\s|$)/u
    : /^.*?(?<!(?:^|[\s(])\p{L})[.!?](?=\s|$)/u;
  const m = end.exec(s);
  return (m ? m[0] : s).trim();
}

/** Languages a package can be printed in: it has texts for them and the builder has page words. */
export function printLanguages(pkg: ContentPackage): string[] {
  return pkg.manifest.languages.filter((l) => l in MESSAGES && pkg.texts[l] !== undefined);
}

export function buildPrintModel(
  pkg: ContentPackage,
  doc: DraftDocument,
  settings: PrintSettings,
  evaluation: Evaluation = evaluateDraft(pkg, doc),
): PrintModel {
  const language = settings.language;
  const messages = MESSAGES[language];
  const texts = pkg.texts[language];
  if (!messages || !texts || !pkg.manifest.languages.includes(language)) {
    throw new PrintError(
      "languageNotSupported",
      `cannot print package "${pkg.manifest.id}" in "${language}"`,
    );
  }
  const ev = evaluation;
  const measure: MeasureContext = {
    units: pkg.units,
    texts,
    language,
    ...(settings.units ? { preferred: settings.units } : {}),
  };
  const things = new Map(pkg.things.map((t) => [t.id, t]));
  const valueDefs = new Map(pkg.values.map((v) => [v.id, v]));
  const held = new Set(ev.things.map((h) => h.id));
  const numberFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  const signed = new Intl.NumberFormat(language, { maximumFractionDigits: 2, signDisplay: "always" });

  /** A package text with placeholders filled; glossary links become plain words on paper. */
  const text = (key: string, vars: Record<string, string | number> = {}): string => {
    const t = texts[key];
    if (typeof t !== "string") return "";
    return renderText(measure, t, vars)
      .map((p) => p.text)
      .join("");
  };
  const paragraphs = (key: string): string[] => {
    const t = texts[key];
    if (Array.isArray(t))
      return t.map((p) =>
        renderText(measure, p)
          .map((x) => x.text)
          .join(""),
      );
    const s = text(key);
    return s === "" ? [] : [s];
  };
  const thingName = (id: string) => text(`${id}.name`) || id;
  const valueOf = (id: string): number => (id === "level" ? ev.level : (ev.values[id] ?? 0));
  const valueText = (id: string): string => {
    const amount = valueOf(id);
    const unit = valueDefs.get(id)?.unit;
    return unit ? formatMeasure(measure, { amount, unit }, "short") : numberFormat.format(amount);
  };
  const valueLabel = (id: string) => (id === "level" ? text("level.name") : text(`value.${id}.name`));
  /** First sentence of a value's explanation: the hint under its box. */
  const valueHint = (id: string): string => firstSentence(text(`value.${id}.explain`), language);
  const statText = (v: StatValue | undefined): string => {
    if (v === undefined) return "—";
    if (typeof v === "number") return numberFormat.format(v);
    if (typeof v === "boolean") return v ? messages.yes : messages.no;
    if ("text" in v) return text(v.text) || "—";
    if ("value" in v) return valueText(v.value);
    return formatMeasure(measure, v, "short");
  };
  const uses = (t: Thing, key: string | undefined): Uses => {
    const stat = key === undefined ? undefined : t.stats?.[key];
    // A stat that names a value has as many boxes as the character's value (uses by level).
    const v = typeof stat === "object" && "value" in stat ? valueOf(stat.value) : stat;
    if (typeof v === "number") return v > 0 ? { boxes: Math.min(12, Math.round(v)) } : null;
    if (typeof v === "object" && "text" in v) return { text: text(v.text) };
    return null;
  };
  // SPEC 13 `when`: a section or box whose condition is false is not printed at all.
  const scope = evaluationScope(pkg, ev);
  const shown = (x: { when?: string | undefined }) =>
    x.when === undefined || evaluateCondition(x.when, scope);
  const heldOf = (source: Parameters<typeof selectThings>[1]): Thing[] => {
    const selected = new Set(selectThings(pkg, source).map((t) => t.id));
    return ev.things.filter((h) => selected.has(h.id)).map((h) => things.get(h.id)!);
  };

  const summary = summarize(pkg, doc, ev);
  const name = summary.name || messages.unnamed;
  const lineVars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(summary.line)) {
    if (v === null) lineVars[k] = "";
    else if (typeof v === "number") lineVars[k] = v;
    else lineVars[k] = thingName(v);
  }
  const levelLabel = `${text("level.name")} ${numberFormat.format(ev.level)}`;
  const packageName = text("package.name");
  const units = effectiveUnits(pkg.units, language, settings.units);
  const unitsLine = messages.unitsUsed(
    Object.values(units).map((u) => text(`unit.${u}.long`) || text(`unit.${u}.short`) || u),
  );
  const createdAt = settings.createdAt ?? new Date();

  const section = (s: Section): SheetSection => {
    const base = {
      id: s.id,
      span: s.span,
      title: text(`sheet.${s.id}.title`),
      hint: text(`sheet.${s.id}.hint`),
    };
    switch (s.kind) {
      case "header":
        return {
          ...base,
          kind: "header",
          name,
          summary: text("summary.line", lineVars),
          packageName,
        };
      case "statBoxes":
        return {
          ...base,
          kind: "statBoxes",
          boxes: s.boxes.filter(shown).map((b) => ({
            label: b.label !== undefined ? text(b.label) : valueLabel(b.value),
            style: b.style,
            text: valueText(b.value),
            circles: b.style === "circles" ? Math.max(0, Math.min(12, Math.round(valueOf(b.value)))) : 0,
            hint: b.style === "pencil" ? messages.startValue(valueText(b.value)) : valueHint(b.value),
          })),
        };
      case "scoreColumn":
        return {
          ...base,
          kind: "scoreColumn",
          scores: s.scores.map((sc) => ({
            label: valueLabel(sc.value),
            value: valueText(sc.value),
            derivedLabel: sc.derived ? valueLabel(sc.derived) : "",
            derived: sc.derived ? signed.format(valueOf(sc.derived)) : null,
          })),
        };
      case "checkList":
        return {
          ...base,
          kind: "checkList",
          items: selectThings(pkg, s.things).map((t) => {
            const note = s.note === undefined ? undefined : t.stats?.[s.note];
            return {
              name: thingName(t.id),
              marked: held.has(t.id),
              note: note === undefined ? "" : statText(note),
            };
          }),
        };
      case "featureTable": {
        const rows = heldOf(s.things).map((t) => ({
          name: thingName(t.id),
          text: text(`${t.id}.short`),
          uses: uses(t, s.uses),
        }));
        // The hint explains the boxes (SPEC 13); without boxes it would point at nothing.
        const boxes = rows.some((r) => r.uses !== null && "boxes" in r.uses);
        return { ...base, hint: s.uses !== undefined && !boxes ? "" : base.hint, kind: "featureTable", rows };
      }
      case "list":
        return {
          ...base,
          kind: "list",
          items: heldOf(s.things).map((t) => thingName(t.id)),
          blankLines: s.blankLines,
        };
      case "answers":
        return {
          ...base,
          kind: "answers",
          rows: s.choices.map((c) => ({ label: text(`choice.${c}.title`), text: answerText(c) })),
        };
      case "helpBox":
        return { ...base, kind: "helpBox", paragraphs: paragraphs(`sheet.${s.id}.text`) };
      case "notes":
        return { ...base, kind: "notes", lines: s.lines };
    }
  };

  /** A choice's answer as words: the text, the number (with unit), or the name of what was picked. */
  function answerText(choiceId: string): string {
    const state = ev.choices[choiceId];
    if (!state || state.status !== "answered") return "";
    const a = state.answer as Record<string, unknown>;
    if (typeof a["text"] === "string") return a["text"].trim();
    if (typeof a["pick"] === "string") return thingName(a["pick"]);
    if (Array.isArray(a["picks"])) return (a["picks"] as string[]).map(thingName).join(", ");
    if (typeof a["value"] === "number") {
      const choice = pkg.flow.choices.find((c) => c.id === choiceId);
      const unit = choice?.kind === "number" ? valueDefs.get(choice.target)?.unit : undefined;
      return unit
        ? formatMeasure(measure, { amount: a["value"], unit }, "short")
        : numberFormat.format(a["value"]);
    }
    return "";
  }

  // SPEC 13 / print layout 3.4: one card per held thing with `card: true`;
  // in step order, then by rank, then by name.
  const stepIndex = new Map(ev.steps.map((s, i) => [s.id, i]));
  const collator = new Intl.Collator(language);
  const cards: Card[] = ev.things
    .map((h) => ({ h, t: things.get(h.id)! }))
    .filter(({ t }) => isCard(pkg, t))
    .map(({ h, t }) => ({ t, step: stepIndex.get(h.step) ?? 0, name: thingName(t.id) }))
    .sort((a, b) => a.step - b.step || (a.t.rank ?? 0) - (b.t.rank ?? 0) || collator.compare(a.name, b.name))
    .map(({ t, name: cardName }) => ({
      typeLine: text(`card.${t.kind}.typeLine`, {
        kind: text(`kind.${t.kind}.name`),
        rank: t.rank ?? 0,
        level: ev.level,
      }),
      name: cardName,
      fields: pkg.sheet.cards[t.kind]!.fields.map((f) => ({
        label: text(`stat.${f}.name`),
        value: statText(t.stats?.[f]),
      })),
      table: text(`${t.id}.explain.table`) || text(`${t.id}.short`),
      rules: paragraphs(`${t.id}.rules`),
      uses: uses(t, pkg.sheet.cards[t.kind]!.uses),
    }));

  return {
    language,
    messages,
    name,
    levelLabel,
    packageName,
    unitsLine,
    attribution: text("sheet.attribution"),
    createdAt,
    createdOn: messages.createdOn(
      new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(createdAt),
    ),
    // A box row whose boxes are all hidden would be a bare title.
    sections: pkg.sheet.sections
      .filter(shown)
      .map(section)
      .filter((s) => s.kind !== "statBoxes" || s.boxes.length > 0),
    cards,
  };
}
