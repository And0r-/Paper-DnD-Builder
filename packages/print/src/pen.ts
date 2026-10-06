/**
 * Drawing on A4 in millimetres with pdfkit, shared by every part of a
 * printout: the sheet in any design, the cards and the rules texts. Text
 * is measured and wrapped here, never below 7 pt, with the embedded font.
 */
import type { Messages, PlayState, Uses } from "@builder/sheet";

export const PT_PER_MM = 72 / 25.4;
/** Size of one typographic point in millimetres. */
export const MM_PER_PT = 25.4 / 72;
// Written out one by one: bundlers can only ship files they see as literal URLs.
export const FONTS = {
  regular: new URL("../fonts/AtkinsonHyperlegibleNext-Regular.ttf", import.meta.url),
  semibold: new URL("../fonts/AtkinsonHyperlegibleNext-SemiBold.ttf", import.meta.url),
  bold: new URL("../fonts/AtkinsonHyperlegibleNext-Bold.ttf", import.meta.url),
};
export type FontName = keyof typeof FONTS;

export interface TextStyle {
  font?: FontName;
  /** Points. Never below 7 (print layout 1). */
  size: number;
  color?: string;
  caps?: boolean;
  /** Letter spacing in em. */
  spacing?: number;
}

/**
 * Marks the font has no glyph for; they are drawn as shapes so a package
 * text like "● = trained" prints as written.
 */
const SHAPES = /([●○◉□■→])/u;

/**
 * Characters the font has no glyph for, mapped to one it has. Package texts
 * come from typeset sources and carry non-breaking hyphens, soft hyphens and
 * thin spaces; printed as is, they would show as empty boxes.
 */
const STAND_INS: Readonly<Record<string, string>> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u00AD": "",
  "\u200B": "",
  "\u2060": "",
  "\uFEFF": "",
  "\u202F": "\u00A0",
  "\u2007": "\u00A0",
  "\u200A": " ",
  "\u2032": "'",
  "\u2033": '"',
};
const MISSING_GLYPHS = new RegExp(`[${Object.keys(STAND_INS).join("")}]`, "gu");

/** Spaces a line may break at: any white space but the non-breaking ones. */
const BREAKS = /[^\S\u00A0\u202F\u2007]+/u;

/**
 * A place where the player writes or ticks, as drawn: its field id, page
 * (from 1) and box in mm, and what the play state put in it.
 */
export interface DrawnField {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text or number written in. */
  text?: string;
  /** Marks ticked, at most as many as the field has. */
  ticks?: number;
}

/**
 * Drawing in millimetres. With `dry` set, nothing is drawn and only sizes
 * are measured: every section is laid out twice, once to find its height
 * and once to draw it, by the same code.
 */
export class Pen {
  readonly doc: PDFKit.PDFDocument;
  readonly language: string;
  /** The builder's page words in the document's language. */
  readonly messages: Messages;
  dry = false;
  /** The play state written into the fields; empty for a sheet to write on by hand. */
  play: PlayState = {};
  /** The page being drawn, from 1: where {@link field} puts a field. */
  page = 0;
  /** Every field drawn, in drawing order. */
  readonly fields: DrawnField[] = [];
  /**
   * Font files by name. pdfkit caches a font under the source it was opened
   * with; a name given to registerFont() for the file that is also the
   * document's default font is never cached and makes pdfkit read and parse
   * the whole file again on every switch (most of the time a big PDF took).
   * Fonts are therefore always selected by their path.
   */
  private readonly fonts: Readonly<Record<FontName, string>>;

  constructor(
    doc: PDFKit.PDFDocument,
    language: string,
    messages: Messages,
    fonts: Record<FontName, string>,
  ) {
    this.doc = doc;
    this.language = language;
    this.messages = messages;
    this.fonts = fonts;
  }

  /** Notes where a field is drawn (not while measuring), and what was filled in. */
  field(
    id: string | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    filled: { text?: string; ticks?: number } = {},
  ): void {
    if (this.dry || id === undefined) return;
    const text = filled.text ? { text: filled.text } : {};
    const ticks = filled.ticks ? { ticks: filled.ticks } : {};
    this.fields.push({ id, page: this.page, x, y, w, h, ...text, ...ticks });
  }

  /** What the play state has to write into a field: its text or number, "" for nothing (or ticks). */
  written(id: string | undefined): string {
    const v = id === undefined ? undefined : this.play[id];
    if (typeof v === "number") return new Intl.NumberFormat(this.language, { useGrouping: false }).format(v);
    return typeof v === "string" ? v : "";
  }

  /** How many of a field's `max` marks the play state ticks; more than there are is cut to `max`. */
  checks(id: string | undefined, max: number): number {
    const v = id === undefined ? undefined : this.play[id];
    return typeof v === "object" ? Math.max(0, Math.min(max, v.checks)) : 0;
  }

  private prepare(s: TextStyle): string {
    this.doc.font(this.fonts[s.font ?? "regular"]).fontSize(s.size);
    return s.color ?? "#000";
  }

  private shown(text: string, s: TextStyle): string {
    const printable = text.replace(MISSING_GLYPHS, (c) => STAND_INS[c] ?? "");
    return s.caps ? printable.toLocaleUpperCase(this.language) : printable;
  }

  private shapeWidth(s: TextStyle): number {
    return s.size * 0.8 * MM_PER_PT;
  }

  /** Width of a single line of text in mm. */
  width(text: string, s: TextStyle): number {
    this.prepare(s);
    const spacing = (s.spacing ?? 0) * s.size;
    let w = 0;
    for (const part of this.shown(text, s).split(SHAPES)) {
      if (part === "") continue;
      if (SHAPES.test(part)) w += this.shapeWidth(s);
      else w += this.doc.widthOfString(part, { characterSpacing: spacing }) / PT_PER_MM;
    }
    return w;
  }

  /**
   * Breaks text into lines no wider than `width`. A word longer than a line
   * is split after a hyphen or slash, or at a soft hyphen (which the package
   * puts where a compound word joins), if it has one; else between letters
   * with a hyphen added.
   */
  wrap(text: string, s: TextStyle, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(BREAKS).filter((w) => w !== "")) {
        const candidate = line === "" ? word : `${line} ${word}`;
        if (this.width(candidate, s) <= width) {
          line = candidate;
          continue;
        }
        if (line !== "") lines.push(line);
        line = word;
        while (this.width(line, s) > width && line.length > 1) {
          const { at, mark } = this.cut(line, s, width);
          lines.push(line.slice(0, at) + mark);
          line = line.slice(at);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Where to split a word that is wider than `width`, and what to print at the end of the first part. */
  private cut(word: string, s: TextStyle, width: number): { at: number; mark: string } {
    for (let at = word.length - 1; at > 0; at--) {
      const soft = word[at - 1] === "\u00ad";
      if (!soft && !/[-/\u2010-\u2012]/u.test(word[at - 1]!)) continue;
      const mark = soft ? "-" : "";
      if (this.width(word.slice(0, at) + mark, s) <= width) return { at, mark };
    }
    // Between letters, at least three on either side, so no "\u2026stellu-ng";
    // only if not even that fits, wherever it fits.
    const letters = (t: string) => t.match(/\p{L}/gu)?.length ?? 0;
    const fits = (at: number) => this.width(`${word.slice(0, at)}-`, s) <= width;
    let at = word.length - 1;
    while (at > 1 && !(fits(at) && letters(word.slice(0, at)) >= 3 && letters(word.slice(at)) >= 3)) at--;
    if (at === 1) {
      at = word.length - 1;
      while (at > 1 && !fits(at)) at--;
    }
    const between = /\p{L}/u.test(word[at - 1]!) && /\p{L}/u.test(word[at]!);
    return { at, mark: between ? "-" : "" };
  }

  /**
   * A label at the largest size from `s.size` down to `min` that fits on one
   * line; if it does not fit even at `min`, wrapped as {@link wrapWords} does.
   */
  label(text: string, s: TextStyle, width: number, min = 7): { style: TextStyle; lines: string[] } {
    const style = this.fit(text, s, width, min);
    if (this.width(text, style) <= width) return { style, lines: [text] };
    return this.wrapWords(text, s, width, min);
  }

  /**
   * Text wrapped at the largest size from `s.size` down to `min` at which
   * every word fits on a line, so lines break only between words, after a
   * hyphen or slash, or at a soft hyphen. Rather a smaller size, tighter
   * letters or no capitals than a word split between letters; that happens
   * only if a word is too long even at `min`.
   */
  wrapWords(text: string, s: TextStyle, width: number, min = 7): { style: TextStyle; lines: string[] } {
    const pieces = text
      .split(BREAKS)
      .flatMap((w) => w.split(/(?<=[-/\u2010-\u2012\u00ad])/u))
      .map((p) => p.replace(/\u00ad$/u, "-"));
    const tries: TextStyle[] = [];
    for (let size = s.size; size >= min; size -= 0.5) tries.push({ ...s, size });
    if (s.spacing) tries.push({ ...s, size: min, spacing: 0 });
    if (s.caps) tries.push({ ...s, size: min, spacing: 0, caps: false });
    for (const t of tries)
      if (pieces.every((p) => this.width(p, t) <= width))
        return { style: t, lines: this.wrap(text, t, width) };
    const style = { ...s, size: Math.min(s.size, min) };
    return { style, lines: this.wrap(text, style, width) };
  }

  /** The largest size from `size` down to `min` at which the text fits on one line. */
  fit(text: string, s: TextStyle, width: number, min = 7): TextStyle {
    let size = s.size;
    while (size > min && this.width(text, { ...s, size }) > width) size = Math.max(min, size - 0.5);
    return { ...s, size };
  }

  /** One line of text; `y` is the baseline. */
  text(text: string, x: number, y: number, s: TextStyle, align: "left" | "center" | "right" = "left"): void {
    if (this.dry || text === "") return;
    const w = this.width(text, s);
    let cx = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
    const color = this.prepare(s);
    const spacing = (s.spacing ?? 0) * s.size;
    for (const part of this.shown(text, s).split(SHAPES)) {
      if (part === "") continue;
      if (SHAPES.test(part)) {
        this.shape(part, cx, y, s.size, color);
        cx += this.shapeWidth(s);
        continue;
      }
      this.prepare(s);
      this.doc.fillColor(color).text(part, cx * PT_PER_MM, y * PT_PER_MM, {
        lineBreak: false,
        baseline: "alphabetic",
        characterSpacing: spacing,
      });
      cx += this.doc.widthOfString(part, { characterSpacing: spacing }) / PT_PER_MM;
    }
  }

  /** Wrapped text from `top`; returns the bottom. */
  paragraph(text: string, x: number, top: number, width: number, s: TextStyle, lead = 1.3): number {
    const lines = this.wrap(text, s, width);
    return this.lines(lines, x, top, s, lead);
  }

  lines(lines: string[], x: number, top: number, s: TextStyle, lead = 1.3): number {
    const h = s.size * lead * MM_PER_PT;
    lines.forEach((l, i) => this.text(l, x, top + s.size * 0.8 * MM_PER_PT + i * h, s));
    return top + lines.length * h;
  }

  lineHeight(s: TextStyle, lead = 1.3): number {
    return s.size * lead * MM_PER_PT;
  }

  private shape(mark: string, x: number, baseline: number, size: number, color: string): void {
    const em = size * MM_PER_PT;
    const cx = x + em * 0.4;
    const cy = baseline - em * 0.33;
    const d = this.doc.save().lineWidth(0.6);
    if (mark === "●" || mark === "○") {
      d.circle(cx * PT_PER_MM, cy * PT_PER_MM, em * 0.3 * PT_PER_MM);
      if (mark === "●") d.fill(color);
      else d.stroke(color);
    } else if (mark === "◉") {
      // As the strong mark in a check list: a dot with a ring around it.
      d.circle(cx * PT_PER_MM, cy * PT_PER_MM, em * 0.34 * PT_PER_MM).stroke(color);
      d.circle(cx * PT_PER_MM, cy * PT_PER_MM, em * 0.2 * PT_PER_MM).fill(color);
    } else if (mark === "□" || mark === "■") {
      const side = em * 0.6;
      d.rect((cx - side / 2) * PT_PER_MM, (cy - side / 2) * PT_PER_MM, side * PT_PER_MM, side * PT_PER_MM);
      if (mark === "■") d.fill(color);
      else d.stroke(color);
    } else {
      const l = x + em * 0.05;
      const r = x + em * 0.75;
      d.moveTo(l * PT_PER_MM, cy * PT_PER_MM)
        .lineTo(r * PT_PER_MM, cy * PT_PER_MM)
        .moveTo((r - em * 0.25) * PT_PER_MM, (cy - em * 0.22) * PT_PER_MM)
        .lineTo(r * PT_PER_MM, cy * PT_PER_MM)
        .lineTo((r - em * 0.25) * PT_PER_MM, (cy + em * 0.22) * PT_PER_MM)
        .stroke(color);
    }
    d.restore();
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, color = "#000"): void {
    if (this.dry) return;
    this.doc
      .save()
      .lineWidth(width)
      .moveTo(x1 * PT_PER_MM, y1 * PT_PER_MM)
      .lineTo(x2 * PT_PER_MM, y2 * PT_PER_MM)
      .stroke(color)
      .restore();
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { stroke?: string; width?: number; fill?: string; radius?: number } = {},
  ): void {
    if (this.dry) return;
    const d = this.doc.save().lineWidth(o.width ?? 0.6);
    if (o.radius)
      d.roundedRect(x * PT_PER_MM, y * PT_PER_MM, w * PT_PER_MM, h * PT_PER_MM, o.radius * PT_PER_MM);
    else d.rect(x * PT_PER_MM, y * PT_PER_MM, w * PT_PER_MM, h * PT_PER_MM);
    if (o.fill && o.stroke) d.fillAndStroke(o.fill, o.stroke);
    else if (o.fill) d.fill(o.fill);
    else d.stroke(o.stroke ?? "#000");
    d.restore();
  }

  /**
   * A tick as written by hand: a cross over a box or circle of size `size`
   * centred at `cx`, `cy`. Not a filled mark, which on a sheet means
   * "trained", not "used".
   */
  tick(cx: number, cy: number, size: number): void {
    const d = size * 0.32;
    this.line(cx - d, cy - d, cx + d, cy + d, 0.7);
    this.line(cx - d, cy + d, cx + d, cy - d, 0.7);
  }

  circle(cx: number, cy: number, r: number, o: { width?: number; fill?: boolean } = {}): void {
    if (this.dry) return;
    const d = this.doc
      .save()
      .lineWidth(o.width ?? 0.6)
      .circle(cx * PT_PER_MM, cy * PT_PER_MM, r * PT_PER_MM);
    if (o.fill) d.fillAndStroke("#000", "#000");
    else d.stroke("#000");
    d.restore();
  }
}

// ------------------------------------------------------------------ styles

export const S = {
  name: { font: "bold", size: 22 },
  summary: { size: 11 },
  sectionTitle: { font: "bold", size: 8, caps: true, spacing: 0.06 },
  bigValue: { font: "bold", size: 22 },
  circlesValue: { font: "bold", size: 15 },
  scoreValue: { font: "bold", size: 20 },
  fieldName: { font: "bold", size: 9 },
  boxValue: { font: "bold", size: 9 },
  body: { size: 9 },
  small: { size: 8.5 },
  hint: { size: 7, color: "#333" },
  mark: { font: "bold", size: 7.5, color: "#333" },
  rowGroup: { font: "bold", size: 7.5, caps: true, spacing: 0.06 },
  meta: { size: 7.5, color: "#444" },
  footer: { size: 7, color: "#444" },
  cardType: { size: 7, caps: true, color: "#333", spacing: 0.06 },
  cardName: { font: "bold", size: 11 },
  cardLabel: { size: 7, caps: true, color: "#333", spacing: 0.06 },
  cardValue: { font: "bold", size: 9 },
  cardHeading: { font: "bold", size: 7, caps: true, spacing: 0.06 },
  cardTable: { size: 8.5 },
  extraValue: { font: "bold", size: 11 },
  fieldLabel: { size: 7, caps: true, color: "#555", spacing: 0.06 },
  fieldValue: { font: "semibold", size: 9.5 },
} satisfies Record<string, TextStyle>;

// ------------------------------------------------------------------ sheet

/** Height of a section's grey title bar, in mm, where no design says otherwise (rules texts). */
export const TITLE_H = 5;

export function sectionTitle(
  pen: Pen,
  title: string,
  x: number,
  y: number,
  w: number,
  height = TITLE_H,
  style: TextStyle = S.sectionTitle,
): number {
  if (title === "") return y;
  pen.rect(x, y, w, height, { fill: "#EDEDED" });
  pen.text(title, x + 2, y + 3.6, pen.fit(title, style, w - 4));
  return y + height + 2;
}

export function hint(pen: Pen, text: string, x: number, y: number, w: number, style = S.hint): number {
  if (text === "") return y;
  return pen.paragraph(text, x, y + 1, w, style);
}

export const USE_BOX = 3;
export const USE_BOX_GAP = 1.2;
/** Width of the field next to a use count, wide enough to write a two-digit number. */
export const USE_FIELD = 8;

/** Width of a thing's use boxes (or its word, like "always"), in mm. */
export function usesWidth(pen: Pen, uses: Uses, s: TextStyle): number {
  if (uses === null) return 0;
  if ("text" in uses) return pen.width(uses.text, s);
  if ("count" in uses) return pen.width(String(uses.count), s) + USE_BOX_GAP + USE_FIELD;
  return uses.boxes * USE_BOX + (uses.boxes - 1) * USE_BOX_GAP;
}

/**
 * Use boxes to tick (or the count and a field), or the word, right-aligned
 * at `right`; `y` is the text baseline. With a play state, the field's
 * ticks fill boxes from the left, and what is left is written in the field.
 */
export function drawUses(pen: Pen, uses: Uses, right: number, y: number, s: TextStyle, field?: string): void {
  if (uses === null) return;
  if ("text" in uses) return pen.text(uses.text, right, y, s, "right");
  const top = y - USE_BOX + 0.4;
  if ("count" in uses) {
    pen.rect(right - USE_FIELD, top, USE_FIELD, USE_BOX, { width: 0.5 });
    const left = pen.written(field);
    pen.field(field, right - USE_FIELD, top, USE_FIELD, USE_BOX, { text: left });
    if (left !== "") pen.text(left, right - USE_FIELD / 2, y, pen.fit(left, s, USE_FIELD - 1), "center");
    return pen.text(String(uses.count), right - USE_FIELD - USE_BOX_GAP, y, s, "right");
  }
  const width = usesWidth(pen, uses, s);
  const ticked = pen.checks(field, uses.boxes);
  pen.field(field, right - width, top, width, USE_BOX, { ticks: ticked });
  for (let i = 0; i < uses.boxes; i++) {
    const left = right - USE_BOX - i * (USE_BOX + USE_BOX_GAP);
    pen.rect(left, top, USE_BOX, USE_BOX, { width: 0.5 });
    if (uses.boxes - 1 - i < ticked) pen.tick(left + USE_BOX / 2, top + USE_BOX / 2, USE_BOX);
  }
}
