/**
 * The character sheet, in one language and one set of units.
 *
 * `buildSheetModel` turns a package, a draft and the reader's settings into
 * plain strings and numbers: every text is looked up in the reader's
 * language, every quantity converted by the package's tables, every
 * condition decided. Screen, PDF and stored copies only show what is here;
 * none of them looks at the package. So "no other language on the sheet"
 * is decided in this one file.
 */
import {
  dependentValues,
  evaluateCondition,
  evaluateDraft,
  evaluationScope,
  filledTextKey,
  effectiveUnits,
  explainValue,
  formatMeasure,
  headTracks,
  renderText,
  selectThings,
  summarize,
  tracksText,
  type ChoiceState,
  type DraftDocument,
  type Evaluation,
  type HeldThing,
  type MeasureContext,
  type PartSource,
} from "@builder/core";
import {
  declaredChoiceId,
  parseExpr,
  type ContentPackage,
  type Expr,
  type FilledText,
  type Mark,
  type Section,
  type StatValue,
  type Thing,
} from "@builder/format/pure";
import type { z } from "zod";
import { isCard } from "./cards.ts";
import { MESSAGES } from "./messages.ts";
import type {
  cardSchema,
  featureRowSchema,
  figureSchema,
  rowGroupSchema,
  rulesGroupSchema,
  sheetModelSchema,
  sheetOriginSchema,
  sheetSectionSchema,
  sheetValueSchema,
  statBoxSchema,
  usesSchema,
} from "./schema.ts";

export interface SheetSettings {
  language: string;
  /** Unit per dimension from the account; missing dimensions follow the language. */
  units?: Readonly<Record<string, string>>;
  /** When the sheet is made: printed in the footer and stored in the PDF. */
  createdAt?: Date;
  /** When the character last changed (the original's `changedAt`). */
  changedAt?: Date;
}

export type StatBox = z.infer<typeof statBoxSchema>;
export type Figure = z.infer<typeof figureSchema>;
export type Uses = z.infer<typeof usesSchema>;
export type SheetSection = z.infer<typeof sheetSectionSchema>;
export type RowGroup = z.infer<typeof rowGroupSchema>;
export type FeatureRow = z.infer<typeof featureRowSchema>;
export type Card = z.infer<typeof cardSchema>;
export type SheetValue = z.infer<typeof sheetValueSchema>;
export type RulesGroup = z.infer<typeof rulesGroupSchema>;
export type SheetOrigin = z.infer<typeof sheetOriginSchema>;
export type SheetModel = z.infer<typeof sheetModelSchema>;

/** Most squares a `boxes` box draws; a larger value is printed as a number instead. */
export const MAX_SQUARES = 24;

export const MAX_USE_BOXES = 12;

export class SheetError extends Error {
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
/** A help text written as "1. … 2. …" in one string, a step a line (screen and PDF). */
export function steps(text: string): string[] {
  return text.split(/\s+(?=\d{1,2}\.\s)/u);
}

export function firstSentence(s: string, language: string): string {
  const ordinals = ORDINAL_DOT.has(language.split("-")[0]!);
  const end = ordinals
    ? /^.*?(?<!(?:^|[\s(])(?:\d+|\p{L}))[.!?](?=\s|$)/u
    : /^.*?(?<!(?:^|[\s(])\p{L})[.!?](?=\s|$)/u;
  const m = end.exec(s);
  return (m ? m[0] : s).trim();
}

/** The tracks a formula adds the levels of, if it is just that: "levelOf('a') + levelOf('b')". */
function levelSum(e: Expr): string[] | undefined {
  if (e.type === "call" && e.fn === "levelOf" && e.args.length === 1 && e.args[0]!.type === "str")
    return [e.args[0]!.value];
  if (e.type === "binary" && e.op === "+") {
    const l = levelSum(e.left);
    const r = levelSum(e.right);
    return l && r ? [...l, ...r] : undefined;
  }
  return undefined;
}

/** Languages a sheet of the package can be made in: it has texts for them and the builder has page words. */
export function sheetLanguages(pkg: ContentPackage): string[] {
  return pkg.manifest.languages.filter((l) => l in MESSAGES && pkg.texts[l] !== undefined);
}

/**
 * Where a field is: package keys joined by "/", which no key contains.
 * "sheet/<section>/<value or thing>/<what>" or "cards/<thing>/uses".
 */
const fieldId = (...keys: string[]): string => keys.join("/");

export function buildSheetModel(
  pkg: ContentPackage,
  doc: DraftDocument,
  settings: SheetSettings,
  evaluation: Evaluation = evaluateDraft(pkg, doc),
): SheetModel {
  const language = settings.language;
  const messages = MESSAGES[language];
  const texts = pkg.texts[language];
  if (!messages || !texts || !pkg.manifest.languages.includes(language)) {
    throw new SheetError(
      "languageNotSupported",
      `cannot make a sheet of package "${pkg.manifest.id}" in "${language}"`,
    );
  }
  const ev = evaluation;
  /** Said for a choice that had nothing to pick (see `ChoiceState.empty`). */
  const nothingToChoose = messages.nothingToChoose;
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
  /**
   * First sentence of a value's explanation: the hint under its box. A value
   * that adds up the levels of tracks (dice of a kind) names those the
   * character has levels in, not every track the package counts.
   */
  const valueHint = (id: string): string => {
    const formula = valueDefs.get(id)?.formula;
    const tracks = formula === undefined ? undefined : levelSum(parseExpr(formula));
    const had = tracks?.filter((t) => (scope.levelOf?.(t) ?? 0) > 0) ?? [];
    if (had.length > 0) return messages.fromLevelsAs(list.format(had.map(thingName)));
    return firstSentence(text(`value.${id}.explain`), language);
  };
  /** On a card: the values to show instead of others (`cardValues` of the choice the thing was picked in). */
  type Swap = Readonly<Record<string, string>>;
  const statText = (v: StatValue | undefined, swap: Swap = {}): string => {
    if (v === undefined) return "—";
    if (typeof v === "number") return numberFormat.format(v);
    if (typeof v === "boolean") return v ? messages.yes : messages.no;
    // `vars` fill the text with the character's values ("1d8 +3").
    if ("text" in v) return filled(v, swap) || "—";
    if ("value" in v) return valueText(swap[v.value] ?? v.value);
    return formatMeasure(measure, v, "short");
  };
  const uses = (t: Thing, key: string | undefined, swap: Swap = {}): Uses => {
    const stat = key === undefined ? undefined : t.stats?.[key];
    // A stat that names a value has as many boxes as the character's value (uses by level).
    const v = typeof stat === "object" && "value" in stat ? valueOf(swap[stat.value] ?? stat.value) : stat;
    if (typeof v === "number") {
      const n = Math.round(v);
      if (n <= 0) return null;
      return n <= MAX_USE_BOXES ? { boxes: n } : { count: n };
    }
    if (typeof v === "object" && "text" in v) return { text: text(filledTextKey(v, scope)) };
    return null;
  };
  /** Uses that are ticked or counted down by hand; a word ("always") is only read. */
  const counts = (u: Uses): boolean => u !== null && !("text" in u);
  const list = new Intl.ListFormat(language, { type: "conjunction" });
  const partLabel = (source: PartSource): string => {
    switch (source.kind) {
      case "values":
        return list.format(source.values.map(valueLabel));
      case "thing":
        // A track's own part names the level reached in it: "Herbalist 2".
        return source.track === source.thing && source.trackLevel !== undefined
          ? `${thingName(source.thing)} ${numberFormat.format(source.trackLevel)}`
          : thingName(source.thing);
      case "choice":
        return text(`choice.${source.choice.split("@")[0]}.title`);
      case "start":
      case "unclear":
        return "";
    }
  };
  /**
   * The character's value as a figure: signed if asked, with its parts as in
   * the builder's explanations. A number of one part has nothing to take
   * apart ("Wit bonus +1" under a +1): paper is short, so it stays alone.
   */
  const figure = (id: string, sign: boolean): Figure => {
    const shown = sign ? signed.format(valueOf(id)) : valueText(id);
    const exp = explainValue(pkg, ev, id);
    const parts = (exp?.parts ?? []).map((p) => ({ label: partLabel(p.source), amount: p.amount }));
    if (parts.length < 2 || parts.every((p) => p.label === "")) return { text: shown, parts: "" };
    // A part's name and its number keep together (no-break space): a line ends between parts.
    return {
      text: shown,
      parts: parts
        .map((p) => (p.label ? `${p.label}\u00a0${signed.format(p.amount)}` : signed.format(p.amount)))
        .join(" · "),
    };
  };
  // SPEC 13 `when`: a section or box whose condition is false is not printed at all.
  const scope = evaluationScope(pkg, ev);
  const shown = (x: { when?: string | undefined }) =>
    x.when === undefined || evaluateCondition(x.when, scope);
  const heldOf = (source: Parameters<typeof selectThings>[1]): Thing[] => {
    const selected = new Set(selectThings(pkg, source).map((t) => t.id));
    return ev.things.filter((h) => selected.has(h.id)).map((h) => things.get(h.id)!);
  };
  const heldById = new Map(ev.things.map((h) => [h.id, h]));
  /** Values the sheet shows somewhere: only these are named as depending on another. The level is in the header. */
  const placed = new Set<string>(["level"]);
  const place = (v: StatValue | undefined, swap: Swap = {}): void => {
    if (typeof v === "object" && "value" in v) placed.add(swap[v.value] ?? v.value);
  };
  /** The things behind a held thing: the one that granted it, or those that granted the choice it was picked in. */
  const origins = (h: HeldThing): string[] =>
    h.grantedBy !== undefined
      ? [h.grantedBy]
      : h.pickedIn !== undefined
        ? (ev.choices[h.pickedIn]?.grantedBy ?? [])
        : [];
  /** Declared ids of the choices (with `options.owned`) that marked a thing. */
  const markedIn = (id: string): string[] => (ev.marks[id] ?? []).map(declaredChoiceId);
  /** Whether a row's thing matches every field of a mark (or of its `not`). */
  const markCondition = (m: Omit<Mark, "text" | "legend" | "not">) => {
    const from = m.from === undefined ? undefined : new Set(selectThings(pkg, m.from).map((t) => t.id));
    // `unmarked` says something only once one of its choices was asked: before that nothing is left out.
    const askedAny = m.unmarked?.some((c) => asked(c).length > 0) ?? false;
    return (t: Thing): boolean => {
      const h = heldById.get(t.id)!;
      const marked = markedIn(t.id);
      return (
        (m.tags ?? []).every((tag) => t.tags?.includes(tag)) &&
        (m.how === undefined || (m.how === "picked" ? h.pickedIn : h.grantedBy) !== undefined) &&
        (from === undefined || origins(h).some((o) => from.has(o))) &&
        (m.pickedIn === undefined ||
          (h.pickedIn !== undefined && m.pickedIn.includes(declaredChoiceId(h.pickedIn)))) &&
        (m.marked === undefined || m.marked.some((c) => marked.includes(c))) &&
        (m.unmarked === undefined || (askedAny && !m.unmarked.some((c) => marked.includes(c))))
      );
    };
  };
  const collator = new Intl.Collator(language);
  /** "8 × Rope"; just the name for one. */
  const counted = (id: string): string => {
    const n = heldById.get(id)?.count ?? 1;
    return n > 1 ? messages.count(numberFormat.format(n), thingName(id)) : thingName(id);
  };
  /**
   * What brought a thing to the character: followed up through the things
   * that granted it and the things that granted the choice it was picked in,
   * to a thing picked in one of the package's own steps (or to itself).
   */
  const origin = (id: string): string => {
    const seen = new Set<string>();
    let at = id;
    for (;;) {
      seen.add(at);
      const h = heldById.get(at);
      const up = h === undefined ? undefined : origins(h)[0];
      if (up === undefined || seen.has(up) || !heldById.has(up)) return at;
      at = up;
    }
  };
  /** Text of a box or stat filled with the character's values; a variant may replace the text. */
  const filled = (v: FilledText, swap: Swap = {}): string => {
    for (const id of Object.values(v.vars ?? {})) placed.add(swap[id] ?? id);
    return text(
      filledTextKey(v, scope),
      Object.fromEntries(Object.entries(v.vars ?? {}).map(([n, id]) => [n, valueOf(swap[id] ?? id)])),
    );
  };
  /** SPEC 9.3 `cardValues`: what the choice a thing was picked in swaps on its card (the numbers of its track). */
  const cardSwap = (h: HeldThing): Swap => {
    if (h.pickedIn === undefined) return {};
    const choice = pkg.flow.choices.find((c) => c.id === declaredChoiceId(h.pickedIn!));
    return choice && (choice.kind === "pickOne" || choice.kind === "pickMany")
      ? (choice.cardValues ?? {})
      : {};
  };

  const summary = summarize(pkg, doc, ev);
  const name = summary.name || messages.unnamed;
  const lineVars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(summary.line)) {
    if (v === null) lineVars[k] = "";
    else if (typeof v === "number") lineVars[k] = v;
    else if (typeof v === "string") lineVars[k] = thingName(v);
    else lineVars[k] = tracksText(v, thingName, (n) => numberFormat.format(n));
  }
  const levelLabel = `${text("level.name")} ${numberFormat.format(ev.level)}`;
  const packageName = text("package.name");
  const units = effectiveUnits(pkg.units, language, settings.units);
  const unitsLine = messages.unitsUsed(
    Object.values(units).map((u) => text(`unit.${u}.long`) || text(`unit.${u}.short`) || u),
  );
  const createdAt = settings.createdAt ?? new Date();

  /** A value without a name of its own is called after the sheet row that shows it (a talent's total). */
  const shownAs = new Map<string, string>();
  const section = (s: Section): SheetSection => {
    const base = {
      id: s.id,
      span: s.span,
      ...(s.apart ? { apart: true } : {}),
      title: text(`sheet.${s.id}.title`),
      hint: text(`sheet.${s.id}.hint`),
    };
    switch (s.kind) {
      case "header": {
        const fields = (s.fields ?? []).map((f) => {
          if ("things" in f)
            return {
              label: text(f.label ?? `kind.${f.things.kind}.name`),
              text: heldOf(f.things)
                .map((t) => thingName(t.id))
                .join(", "),
            };
          if ("choice" in f)
            return { label: text(f.label ?? `choice.${f.choice}.title`), text: answerText(f.choice) };
          // The tracks with their levels, "A 3 / B 2" (SPEC 9.7); labelled like the tracks choice.
          return {
            label: text(f.label ?? `choice.${pkg.flow.level.tracks?.choice ?? ""}.title`),
            text: tracksText(headTracks(ev), thingName, (n) => numberFormat.format(n)),
          };
        });
        // More than one track: the head orders them by levels, so it also says which came first
        // (SPEC 9.7) — right after the tracks field if there is one, else first.
        const tracks = ev.tracks?.list ?? [];
        if (tracks.length > 1)
          fields.splice((s.fields ?? []).findIndex((f) => "tracks" in f) + 1, 0, {
            label: messages.startedAs,
            text: thingName(tracks[0]!.thing),
          });
        return {
          ...base,
          kind: "header",
          name,
          summary: text("summary.line", lineVars),
          packageName,
          playedByField: fieldId("sheet", s.id, "playedBy"),
          fields,
        };
      }
      case "statBoxes": {
        // Two boxes of one value in a section are told apart by their place among the package's boxes, not the shown ones.
        const field = (b: (typeof s.boxes)[number]): string => {
          const same = s.boxes.filter((x) => x.value === b.value);
          return same.length > 1
            ? fieldId("sheet", s.id, b.value, String(same.indexOf(b) + 1))
            : fieldId("sheet", s.id, b.value);
        };
        return {
          ...base,
          kind: "statBoxes",
          boxes: s.boxes.filter(shown).map((b): StatBox => {
            placed.add(b.value);
            const n = Math.max(0, Math.round(valueOf(b.value)));
            const squares = b.style === "boxes" && n <= MAX_SQUARES ? n : 0;
            return {
              valueId: b.value,
              label: b.label !== undefined ? text(b.label) : valueLabel(b.value),
              style: b.style,
              // Squares say how many on their own; too many to draw, the number says it.
              text:
                b.text !== undefined
                  ? filled(b.text)
                  : b.style === "boxes" && squares === n
                    ? ""
                    : valueText(b.value),
              circles: b.style === "circles" ? Math.min(12, n) : 0,
              squares,
              hint: b.style === "pencil" ? messages.startValue(valueText(b.value)) : valueHint(b.value),
              ...(b.style === "number" ? {} : { field: field(b) }),
            };
          }),
        };
      }
      case "scoreColumn":
        return {
          ...base,
          kind: "scoreColumn",
          scores: s.scores.map((sc) => {
            for (const id of [sc.value, sc.derived, sc.extra]) if (id !== undefined) placed.add(id);
            return {
              valueId: sc.value,
              label: valueLabel(sc.value),
              value: valueText(sc.value),
              ...(sc.derived ? { derivedId: sc.derived } : {}),
              derivedLabel: !sc.derived
                ? ""
                : sc.derivedLabel !== undefined
                  ? text(sc.derivedLabel)
                  : valueLabel(sc.derived),
              derived: sc.derived ? signed.format(valueOf(sc.derived)) : null,
              extra: sc.extra
                ? {
                    label: sc.extraLabel !== undefined ? text(sc.extraLabel) : valueLabel(sc.extra),
                    value: signed.format(valueOf(sc.extra)),
                  }
                : null,
            };
          }),
        };
      case "checkList": {
        const strong = new Set(
          s.strong === undefined ? [] : heldOf(s.strong).flatMap((t) => (t.about ? [t.about] : [])),
        );
        const items = selectThings(pkg, s.things).map((t) => {
          const note = s.note === undefined ? undefined : t.stats?.[s.note];
          const total = s.total === undefined ? undefined : t.stats?.[s.total];
          const byHand = !(typeof total === "object" && "value" in total);
          place(total);
          if (!byHand && !shownAs.has(total.value)) shownAs.set(total.value, thingName(t.id));
          return {
            id: t.id,
            name: thingName(t.id),
            marked: held.has(t.id),
            strong: held.has(t.id) && strong.has(t.id),
            note: note === undefined ? "" : statText(note),
            // A roll is added to: the number goes in with its sign ("+5").
            total:
              typeof total === "object" && "value" in total
                ? figure(total.value, true)
                : { text: "", parts: "" },
            ...(byHand ? { field: fieldId("sheet", s.id, t.id, "total") } : {}),
          };
        });
        return {
          ...base,
          kind: "checkList",
          items,
          // Like the marks of a table: what ◉ means only where a row has it.
          legend: s.strongLegend !== undefined && items.some((i) => i.strong) ? [text(s.strongLegend)] : [],
        };
      }
      case "statTable":
        return {
          ...base,
          kind: "statTable",
          columns: s.columns.map((c) => text(`stat.${c.stat}.name`)),
          wrap: s.columns.map((c) => c.wrap === true),
          rows: heldOf(s.things).map((t) => ({
            name: thingName(t.id),
            // Numbers only: a table row is one line, so a few weapons still fit beside other boxes.
            cells: s.columns.map((c) => {
              const v = t.stats?.[c.stat];
              place(v);
              const n = typeof v === "object" && "value" in v ? valueOf(v.value) : v;
              return c.signed && typeof n === "number" ? signed.format(n) : statText(v);
            }),
          })),
        };
      case "featureTable": {
        // Marks with the same sign and legend are one mark: one sign on a row, one legend entry.
        const signs: { text: string; legend: string }[] = [];
        const signOf = (s.marks ?? []).map((m) => {
          const i = signs.findIndex((x) => x.text === m.text && x.legend === m.legend);
          if (i >= 0) return i;
          signs.push({ text: m.text, legend: m.legend });
          return signs.length - 1;
        });
        const markOn = (s.marks ?? []).map((m) => {
          const matches = markCondition(m);
          const not = m.not === undefined ? undefined : markCondition(m.not);
          return (t: Thing): boolean => matches(t) && !not?.(t);
        });
        let held = heldOf(s.things);
        if (s.byRank) {
          // Lowest rank first, by name inside a rank; things without a rank last, as they came.
          const ranked = held
            .filter((t) => t.rank !== undefined)
            .sort((a, b) => a.rank! - b.rank! || collator.compare(thingName(a.id), thingName(b.id)));
          held = [...ranked, ...held.filter((t) => t.rank === undefined)];
        }
        // Rows from more than one track (SPEC 9.7): a block per track, most levels first, its ranks
        // inside, so the player sees which track a row belongs to. A row of no track goes with
        // where it came from, after the tracks.
        const blockOf = new Map<string, string>();
        if (s.byRank && new Set(held.flatMap((t) => heldById.get(t.id)?.track ?? [])).size > 1) {
          for (const t of held) blockOf.set(t.id, heldById.get(t.id)?.track ?? origin(t.id));
          const order = [...new Set([...headTracks(ev).map((t) => t.thing), ...blockOf.values()])];
          held = order.flatMap((b) => held.filter((t) => blockOf.get(t.id) === b));
        }
        // groupBy origin: groups in the order their first row came; inside a group, the order stays.
        const originOf = new Map(s.groupBy === "origin" ? held.map((t) => [t.id, origin(t.id)]) : []);
        if (s.groupBy === "origin") {
          const order = [...new Set(held.map((t) => originOf.get(t.id)!))];
          held = order.flatMap((o) => held.filter((t) => originOf.get(t.id) === o));
        }
        const used = new Set<number>();
        // A thing that grants a choice with nothing to pick says so on its row.
        const emptyBy = new Set(
          Object.values(ev.choices).flatMap((c) => (c.empty === true ? (c.grantedBy ?? []) : [])),
        );
        const rows = held.map((t): FeatureRow => {
          const on = [...new Set(markOn.flatMap((matches, i) => (matches(t) ? [signOf[i]!] : [])))].sort(
            (a, b) => a - b,
          );
          on.forEach((i) => used.add(i));
          const rank = s.byRank ? t.rank : undefined;
          const from = originOf.get(t.id);
          const block = blockOf.get(t.id);
          const rankTitle =
            rank === undefined
              ? ""
              : text(`rank.${rank}.name`) || `${text("rank.name")} ${numberFormat.format(rank)}`;
          const note = s.note === undefined ? undefined : t.stats?.[s.note];
          const rowUses = uses(t, s.uses);
          place(note);
          if (s.uses !== undefined) place(t.stats?.[s.uses]);
          return {
            id: t.id,
            name: thingName(t.id),
            marks: on.map((i) => text(signs[i]!.text)).join(" "),
            note: [note === undefined ? "" : statText(note), emptyBy.has(t.id) ? nothingToChoose : ""]
              .filter((n) => n !== "")
              .join(" · "),
            text: text(`${t.id}.short`),
            uses: rowUses,
            ...(counts(rowUses) ? { usesField: fieldId("sheet", s.id, t.id, "uses") } : {}),
            group:
              from !== undefined
                ? { key: `origin-${from}`, title: thingName(from), hint: "" }
                : block !== undefined
                  ? {
                      key: rank === undefined ? `block-${block}` : `block-${block}-rank-${rank}`,
                      title: [thingName(block), rankTitle].filter((x) => x !== "").join(" · "),
                      hint: rank === undefined ? "" : text(`sheet.${s.id}.rank.${rank}.hint`),
                    }
                  : rank === undefined
                    ? null
                    : {
                        key: `rank-${rank}`,
                        title: rankTitle,
                        hint: text(`sheet.${s.id}.rank.${rank}.hint`),
                      },
          };
        });
        const legend = signs.flatMap((m, i) => (used.has(i) ? [`${text(m.text)} = ${text(m.legend)}`] : []));
        // A track that brought no row here has nothing in this table its sentence could be about.
        const tracks = new Set(ev.tracks?.list.map((t) => t.thing) ?? []);
        const rowTracks = new Set(held.flatMap((t) => heldById.get(t.id)?.track ?? []));
        const lead =
          s.lead === undefined
            ? []
            : heldOf(s.lead.things)
                .filter((t) => !tracks.has(t.id) || rowTracks.has(t.id))
                .map((t) => text(`${t.id}.${s.lead!.text}`))
                .filter((l) => l !== "");
        // The hint explains the boxes (SPEC 13); without boxes it would point at nothing.
        const boxes = rows.some((r) => r.uses !== null && "boxes" in r.uses);
        return {
          ...base,
          hint: s.uses !== undefined && !boxes ? "" : base.hint,
          kind: "featureTable",
          lead,
          rows,
          legend,
        };
      }
      case "list": {
        const listed = heldOf(s.things);
        // One line per thing, also for a counted one ("2 × Kit"): what one of them holds.
        const details = s.detail === undefined ? [] : listed.map((t) => text(`${t.id}.${s.detail}`));
        return {
          ...base,
          kind: "list",
          items: listed.map((t) => counted(t.id)),
          ...(details.some((d) => d !== "") ? { details } : {}),
          blankLines: s.blankLines,
          ...(s.blankLines > 0 ? { field: fieldId("sheet", s.id, "lines") } : {}),
        };
      }
      case "answers":
        return {
          ...base,
          kind: "answers",
          // A choice the character was never asked, not even as a copy, has no row.
          rows: s.choices
            .filter((c) => asked(c).length > 0)
            .map((c) => ({ label: text(`choice.${c}.title`), text: answerText(c) })),
        };
      case "helpBox":
        return { ...base, kind: "helpBox", paragraphs: paragraphs(`sheet.${s.id}.text`) };
      case "notes":
        return { ...base, kind: "notes", lines: s.lines, field: fieldId("sheet", s.id, "notes") };
    }
  };

  /** The choice as asked: itself, or every copy a repeatable thing asked, in step order. */
  function asked(choiceId: string): ChoiceState[] {
    return Object.values(ev.choices).filter((c) => c.id === choiceId || c.copyOf === choiceId);
  }

  /** A choice's answers as words, those of all its copies in one line ("Warm Glow, Glow Thread"). */
  function answerText(choiceId: string): string {
    return asked(choiceId)
      .map((c) => oneAnswer(c, choiceId))
      .filter((t) => t !== "")
      .join(", ");
  }

  /** One answer as words: the text, the number (with unit), or the name of what was picked. */
  function oneAnswer(state: ChoiceState, choiceId: string): string {
    if (state.empty === true) return nothingToChoose;
    if (state.status !== "answered") return "";
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
  // in step order (things every character has first), then by rank, then by name.
  const stepIndex = new Map(ev.steps.map((s, i) => [s.id, i]));
  const cards: Card[] = ev.things
    .map((h) => ({ h, t: things.get(h.id)! }))
    .filter(({ t }) => isCard(pkg, t))
    .map(({ h, t }) => ({
      t,
      swap: cardSwap(h),
      step: h.step === undefined ? -1 : (stepIndex.get(h.step) ?? 0),
      name: thingName(t.id),
    }))
    .sort((a, b) => a.step - b.step || (a.t.rank ?? 0) - (b.t.rank ?? 0) || collator.compare(a.name, b.name))
    .map(({ t, swap, name: cardName }): Card => {
      const layout = pkg.sheet.cards[t.kind]!;
      const cardUses = uses(t, layout.uses, swap);
      if (layout.uses !== undefined) place(t.stats?.[layout.uses], swap);
      for (const f of layout.fields) place(t.stats?.[f], swap);
      // The first entry whose condition the thing matches, in the package's order.
      const line = layout.origins?.find((o) => markCondition(o)(t) && !(o.not && markCondition(o.not)(t)));
      return {
        id: t.id,
        typeLine: text(`card.${t.kind}.typeLine`, {
          kind: text(`kind.${t.kind}.name`),
          rank: t.rank ?? 0,
          level: ev.level,
        }),
        name: cardName,
        fields: layout.fields.map((f) => ({
          label: text(`stat.${f}.name`),
          value: statText(t.stats?.[f], swap),
        })),
        ...(line
          ? {
              origin: {
                label: line.label !== undefined ? text(line.label) : thingName(origin(t.id)),
                value: filled(line.text, swap),
              },
            }
          : {}),
        table: text(`${t.id}.explain.table`) || text(`${t.id}.short`),
        rules: paragraphs(`${t.id}.rules`),
        uses: cardUses,
        ...(counts(cardUses) ? { usesField: fieldId("cards", t.id, "uses") } : {}),
        hint: text(`card.${t.kind}.hint`),
      };
    });

  // A box row whose boxes are all hidden would be a bare title.
  const sections = pkg.sheet.sections
    .filter(shown)
    .map(section)
    .filter(
      (s) => (s.kind !== "statBoxes" || s.boxes.length > 0) && (s.kind !== "answers" || s.rows.length > 0),
    );

  // "These depend on it": only values with a name, or on the sheet under one, can be told to a player,
  // and only those the sheet shows: a weapon the character does not hold has nothing that changes.
  const dependents = dependentValues(pkg, ev);
  const nameOf = (id: string): string => valueLabel(id) || (shownAs.get(id) ?? "");
  const values: SheetValue[] = ["level", ...pkg.values.map((v) => v.id)]
    .filter((id) => nameOf(id) !== "")
    .map((id) => ({
      id,
      label: nameOf(id),
      text: valueText(id),
      dependents: (dependents[id] ?? [])
        .filter((d) => placed.has(d) && nameOf(d) !== "")
        .map((d) => ({ id: d, label: nameOf(d) })),
    }));

  // The full texts of every thing in a table or on a card, grouped by what brought it, in step order.
  const onSheet = new Set([
    ...sections.flatMap((s) => (s.kind === "featureTable" ? s.rows.map((r) => r.id) : [])),
    ...cards.map((c) => c.id),
  ]);
  const rulesTexts: RulesGroup[] = [];
  for (const h of ev.things) {
    if (!onSheet.has(h.id)) continue;
    const from = origin(h.id);
    let group = rulesTexts.find((g) => g.origin === from);
    if (group === undefined) {
      group = { origin: from, title: thingName(from), entries: [] };
      rulesTexts.push(group);
    }
    group.entries.push({
      id: h.id,
      name: thingName(h.id),
      kindName: text(`kind.${h.kind}.name`),
      rules: paragraphs(`${h.id}.rules`),
      explain: ["what", "table", "example"].map((k) => text(`${h.id}.explain.${k}`)).filter((p) => p !== ""),
    });
  }

  // Content of an extension that may not be shared, if the character has any (SPEC 17.7).
  const had = new Set(ev.things.map((h) => h.id));
  const closed = (pkg.extensions ?? [])
    .filter((x) => !x.publishable && x.things.some((id) => had.has(id)))
    .map((x) => x.name[language] ?? x.id);
  const notForSharing = closed.length > 0 ? messages.notForSharing(list.format(closed)) : "";

  return {
    version: 1,
    language,
    origin: {
      kind: "original",
      level: ev.level,
      builtAt: createdAt.toISOString(),
      packageVersion: pkg.manifest.version,
      ...(settings.changedAt ? { changedAt: settings.changedAt.toISOString() } : {}),
    },
    packageId: pkg.manifest.id,
    name,
    level: ev.level,
    levelLabel,
    packageName,
    units,
    unitsLine,
    attribution: [text("sheet.attribution"), notForSharing].filter((l) => l !== "").join(" "),
    createdOn: messages.createdOn(
      new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(createdAt),
    ),
    sections,
    cards,
    values,
    rulesTexts,
  };
}

/**
 * What each field of a sheet is called on it ("Stamina", the row's or the
 * card's name), so a screen can say which field someone else changed. A
 * field without words of its own is named by its section.
 */
export function sheetFieldNames(
  model: Pick<SheetModel, "language" | "sections" | "cards">,
): Map<string, string> {
  const out = new Map<string, string>();
  const put = (field: string | undefined, ...names: string[]) => {
    const name = names.find((n) => n !== "");
    if (field && name && !out.has(field)) out.set(field, name);
  };
  for (const s of model.sections) {
    switch (s.kind) {
      case "header":
        put(s.playedByField, (MESSAGES[model.language] ?? MESSAGES["en"]!).playedBy);
        break;
      case "statBoxes":
        for (const b of s.boxes) put(b.field, b.label, s.title);
        break;
      case "checkList":
        for (const i of s.items) put(i.field, i.name, s.title);
        break;
      case "featureTable":
        for (const r of s.rows) put(r.usesField, r.name, s.title);
        break;
      case "list":
      case "notes":
        put(s.field, s.title);
        break;
      default:
        break;
    }
  }
  for (const c of model.cards) put(c.usesField, c.name);
  return out;
}

/** Every field of a sheet, in the order they are on it: sheet first, then the cards. */
export function sheetFields(model: Pick<SheetModel, "sections" | "cards">): string[] {
  const out: string[] = [];
  for (const s of model.sections) {
    switch (s.kind) {
      case "header":
        if (s.playedByField) out.push(s.playedByField);
        break;
      case "statBoxes":
        for (const b of s.boxes) if (b.field) out.push(b.field);
        break;
      case "checkList":
        for (const i of s.items) if (i.field) out.push(i.field);
        break;
      case "featureTable":
        for (const r of s.rows) if (r.usesField) out.push(r.usesField);
        break;
      case "list":
      case "notes":
        if (s.field) out.push(s.field);
        break;
      default:
        break;
    }
  }
  for (const c of model.cards) if (c.usesField) out.push(c.usesField);
  return out;
}
