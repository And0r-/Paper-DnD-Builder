/**
 * Lays out a {@link PrintModel} on A4 and writes the PDF.
 *
 * All measures are in millimetres and follow the print layout spec (12 mm
 * margins, a 12-column grid, 63 × 88 mm cards in a 3 × 3 grid with cut lines
 * and crop marks). The PDF is drawn with pdfkit: plain vector drawing with
 * the font embedded, so text stays extractable, sizes are exact and the
 * server needs no browser. The PDF has no links, no form fields and no
 * scripts, and it never refers to anything outside itself.
 */
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { Messages } from "./messages.ts";
import type { Card, PrintModel, RowGroup, SheetSection, StatBox, Uses } from "./model.ts";

const PT_PER_MM = 72 / 25.4;
/** Size of one typographic point in millimetres. */
const MM_PER_PT = 25.4 / 72;
const PAGE_W = 210;
const PAGE_H = 297;

// Character sheet (print layout 1, 2.1)
const MARGIN = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const COLUMN_GAP = 4;
const COLUMN_W = (CONTENT_W - 11 * COLUMN_GAP) / 12;
const ROW_GAP = 6;
const FOOTER_LINE_Y = PAGE_H - MARGIN - 4;
const CONTENT_BOTTOM = FOOTER_LINE_Y - 3;
const TITLE_H = 5;

// Cards (print layout 3.1)
const CARD_W = 63;
const CARD_H = 88;
const GRID_X = (PAGE_W - 3 * CARD_W) / 2;
const GRID_Y = (PAGE_H - 3 * CARD_H) / 2;
const CARD_PAD = 4;
const CARDS_PER_PAGE = 9;
const CROP_GAP = 1.5;
const CROP_LEN = 4;

// Written out one by one: bundlers can only ship files they see as literal URLs.
const FONTS = {
  regular: new URL("../fonts/AtkinsonHyperlegibleNext-Regular.ttf", import.meta.url),
  semibold: new URL("../fonts/AtkinsonHyperlegibleNext-SemiBold.ttf", import.meta.url),
  bold: new URL("../fonts/AtkinsonHyperlegibleNext-Bold.ttf", import.meta.url),
};
type FontName = keyof typeof FONTS;

interface TextStyle {
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
const SHAPES = /([●○□■→])/u;

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
 * Drawing in millimetres. With `dry` set, nothing is drawn and only sizes
 * are measured: every section is laid out twice, once to find its height
 * and once to draw it, by the same code.
 */
class Pen {
  readonly doc: PDFKit.PDFDocument;
  readonly language: string;
  /** The builder's page words in the document's language. */
  readonly messages: Messages;
  dry = false;
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
   * is split after a hyphen or slash if it has one, else between letters
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
    for (let at = word.length - 1; at > 0; at--)
      if (/[-/\u2010-\u2012]/u.test(word[at - 1]!) && this.width(word.slice(0, at), s) <= width)
        return { at, mark: "" };
    let at = word.length - 1;
    while (at > 1 && this.width(`${word.slice(0, at)}-`, s) > width) at--;
    const between = /\p{L}/u.test(word[at - 1]!) && /\p{L}/u.test(word[at]!);
    return { at, mark: between ? "-" : "" };
  }

  /**
   * A label at the largest size from `s.size` down to `min` that fits on one
   * line; if it does not fit even at `min`, wrapped at `min`.
   */
  label(text: string, s: TextStyle, width: number, min = 7): { style: TextStyle; lines: string[] } {
    const style = this.fit(text, s, width, min);
    if (this.width(text, style) <= width) return { style, lines: [text] };
    // Rather a smaller size, tighter letters or no capitals than a word split between letters.
    const pieces = text.split(BREAKS).flatMap((w) => w.split(/(?<=[-/\u2010-\u2012])/u));
    const tries: TextStyle[] = [];
    for (let size = s.size; size >= min; size -= 0.5) tries.push({ ...s, size });
    if (s.spacing) tries.push({ ...s, size: min, spacing: 0 });
    if (s.caps) tries.push({ ...s, size: min, spacing: 0, caps: false });
    for (const t of tries)
      if (pieces.every((p) => this.width(p, t) <= width))
        return { style: t, lines: this.wrap(text, t, width) };
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

const S = {
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
} satisfies Record<string, TextStyle>;

const RULES_SIZES = [7.5, 7.25, 7];
const CARD_LEAD = 1.25;

// ------------------------------------------------------------------ sheet

function sectionTitle(pen: Pen, title: string, x: number, y: number, w: number): number {
  if (title === "") return y;
  pen.rect(x, y, w, TITLE_H, { fill: "#EDEDED" });
  pen.text(title, x + 2, y + 3.6, pen.fit(title, S.sectionTitle, w - 4));
  return y + TITLE_H + 2;
}

function hint(pen: Pen, text: string, x: number, y: number, w: number): number {
  if (text === "") return y;
  return pen.paragraph(text, x, y + 1, w, S.hint);
}

const USE_BOX = 3;
const USE_BOX_GAP = 1.2;
/** Width of the field next to a use count, wide enough to write a two-digit number. */
const USE_FIELD = 8;

/** Width of a thing's use boxes (or its word, like "always"), in mm. */
function usesWidth(pen: Pen, uses: Uses, s: TextStyle): number {
  if (uses === null) return 0;
  if ("text" in uses) return pen.width(uses.text, s);
  if ("count" in uses) return pen.width(String(uses.count), s) + USE_BOX_GAP + USE_FIELD;
  return uses.boxes * USE_BOX + (uses.boxes - 1) * USE_BOX_GAP;
}

/** Use boxes to tick (or the count and a field), or the word, right-aligned at `right`; `y` is the text baseline. */
function drawUses(pen: Pen, uses: Uses, right: number, y: number, s: TextStyle): void {
  if (uses === null) return;
  if ("text" in uses) return pen.text(uses.text, right, y, s, "right");
  const top = y - USE_BOX + 0.4;
  if ("count" in uses) {
    pen.rect(right - USE_FIELD, top, USE_FIELD, USE_BOX, { width: 0.5 });
    return pen.text(String(uses.count), right - USE_FIELD - USE_BOX_GAP, y, s, "right");
  }
  for (let i = 0; i < uses.boxes; i++)
    pen.rect(right - USE_BOX - i * (USE_BOX + USE_BOX_GAP), top, USE_BOX, USE_BOX, { width: 0.5 });
}

/**
 * The heading of a group of table rows: its title and, on the same line if
 * it fits, its hint ("Rank 2 · no slot needed"), under a darker line. Kept
 * low, as a table of many ranks gets one per rank. Returns the new top.
 */
function drawRowGroup(pen: Pen, group: RowGroup, x: number, y: number, w: number, first: boolean): number {
  if (!first) pen.line(x, y - 0.6, x + w, y - 0.6, 0.6, "#555");
  const top = y + 0.3;
  const baseline = top + S.rowGroup.size * 0.8 * MM_PER_PT;
  const title = pen.fit(group.title, S.rowGroup, w);
  pen.text(group.title, x, baseline, title);
  let bottom = top + pen.lineHeight(S.rowGroup, 1.1);
  if (group.hint !== "") {
    const after = pen.width(group.title, title) + 3;
    if (pen.width(group.hint, S.hint) <= w - after) pen.text(group.hint, x + after, baseline, S.hint);
    else bottom = pen.paragraph(group.hint, x, bottom, w, S.hint, 1.15);
  }
  return bottom;
}

/** Draws one section (or only measures it, if the pen is dry). Returns its height. */
function drawSection(pen: Pen, s: SheetSection, x: number, top: number, w: number): number {
  if (s.kind === "header") return drawHeader(pen, s, x, top, w);
  let y = sectionTitle(pen, s.title, x, top, w);
  switch (s.kind) {
    case "statBoxes":
      y = drawStatBoxes(pen, s.boxes, x, y, w);
      break;
    case "scoreColumn":
      for (const sc of s.scores) {
        const label = pen.label(sc.label, S.fieldName, w - 25);
        const labelLh = pen.lineHeight(label.style, 1.15);
        // The derived label shares the top line with the label if both fit;
        // else it gets lines of its own above it, so the two never overlap.
        const besideW = w - 5 - pen.width(label.lines[0]!, label.style) - 3;
        const beside = sc.derived !== null && pen.width(sc.derivedLabel, S.hint) <= besideW;
        const above = sc.derived === null || beside ? [] : pen.wrap(sc.derivedLabel, S.hint, w - 4);
        const aboveLh = pen.lineHeight(S.hint, 1.15);
        const top = y + above.length * aboveLh;
        const h = 19 + (top - y) + (label.lines.length - 1) * labelLh;
        const body = top + (label.lines.length - 1) * labelLh;
        pen.rect(x, y, w, h, { width: 0.7, radius: 1.5 });
        above.forEach((l, j) => pen.text(l, x + w - 2, y + 3.4 + j * aboveLh, S.hint, "right"));
        label.lines.forEach((l, j) => pen.text(l, x + 3, top + 5 + j * labelLh, label.style));
        pen.text(sc.value, x + 3, body + 15.5, pen.fit(sc.value, S.scoreValue, w - 25, 12));
        if (sc.derived !== null) {
          const cx = x + w - 11;
          pen.circle(cx, body + 11.5, 6.3, { width: 0.7 });
          pen.text(
            sc.derived,
            cx,
            body + 13.7,
            pen.fit(sc.derived, { font: "bold", size: 12 }, 11),
            "center",
          );
          if (beside) pen.text(sc.derivedLabel, x + w - 2, y + 3.4, S.hint, "right");
        }
        y += h + 3;
      }
      y -= 3;
      break;
    case "checkList": {
      const columns = w >= 90 ? 2 : 1;
      const cw = (w - (columns - 1) * 4) / columns;
      const laid = s.items.map((item) => {
        const noteW = item.note === "" ? 0 : Math.min(pen.width(item.note, S.hint), (cw - 15) / 2);
        const name = pen.label(item.name, S.body, cw - 15 - (noteW > 0 ? noteW + 2 : 0));
        const note = pen.label(item.note, S.hint, Math.max(noteW, 1));
        const lh = pen.lineHeight(name.style, 1.15);
        // Where the number in the box comes from, small under the name.
        const parts = item.total.parts === "" ? [] : pen.wrap(item.total.parts, S.hint, cw - 10.5);
        const partsLh = pen.lineHeight(S.hint, 1.15);
        // A name, note or origin that needs more lines makes its row taller.
        const extra =
          Math.max((name.lines.length - 1) * lh, (note.lines.length - 1) * pen.lineHeight(note.style, 1.15)) +
          parts.length * partsLh;
        return { item, name, note, lh, parts, partsLh, extra };
      });
      let rowTop = y;
      for (let r = 0; r * columns < laid.length; r++) {
        const row = laid.slice(r * columns, (r + 1) * columns);
        for (const [c, { item, name, note, lh, parts, partsLh }] of row.entries()) {
          const cx = x + c * (cw + 4);
          const cy = rowTop + 4.5;
          pen.circle(cx + 2, cy - 1.3, 1.6, { fill: item.marked });
          name.lines.forEach((l, j) => pen.text(l, cx + 5.5, cy + j * lh, name.style));
          const noteLh = pen.lineHeight(note.style, 1.15);
          note.lines.forEach((l, j) => pen.text(l, cx + cw - 9.5, cy + j * noteLh, note.style, "right"));
          pen.rect(cx + cw - 7.5, cy - 4.2, 7, 5.5, { width: 0.5, radius: 0.8 });
          const total = item.total.text;
          pen.text(total, cx + cw - 4, cy, pen.fit(total, S.boxValue, 6.4), "center");
          const partsTop = cy + (name.lines.length - 1) * lh + 0.9;
          parts.forEach((l, j) => pen.text(l, cx + 5.5, partsTop + (j + 0.8) * partsLh, S.hint));
        }
        rowTop += 7 + Math.max(...row.map((l) => l.extra));
      }
      y = rowTop;
      break;
    }
    case "featureTable": {
      // The marks get room of their own at the right end of the name column, so names wrap no sooner.
      const marksW = Math.max(0, ...s.rows.map((r) => pen.width(r.marks, S.mark)));
      const markRoom = marksW > 0 ? marksW + 1.5 : 0;
      const nameW = Math.min(36, w * 0.36) + markRoom;
      // A column for the use boxes, as wide as the widest row needs.
      const usesW = Math.max(0, ...s.rows.map((r) => usesWidth(pen, r.uses, S.small)));
      const textW = w - nameW - (usesW > 0 ? usesW + 3 : 0);
      for (const lead of s.lead) y = pen.paragraph(lead, x, y, w, S.small) + 1;
      let group: string | null = null;
      for (const row of s.rows) {
        if (row.group !== null && row.group.key !== group)
          y = drawRowGroup(pen, row.group, x, y, w, row === s.rows[0]);
        group = row.group?.key ?? null;
        const nameLines = pen.wrap(row.name, S.fieldName, nameW - 2 - markRoom);
        const textLines = pen.wrap(row.text, S.small, textW);
        if (row.marks !== "")
          pen.text(row.marks, x + nameW - 2, y + 0.8 + S.fieldName.size * 0.8 * MM_PER_PT, S.mark, "right");
        const nameBottom = pen.lines(nameLines, x, y + 0.8, S.fieldName, 1.2);
        const textBottom = pen.lines(textLines, x + nameW, y + 0.9, S.small, 1.25);
        drawUses(pen, row.uses, x + w, y + 0.9 + S.small.size * 0.8 * MM_PER_PT, S.small);
        y = Math.max(nameBottom, textBottom) + 1.4;
        pen.line(x, y, x + w, y, 0.3, "#BBB");
        y += 0.6;
      }
      if (s.legend.length > 0) y = pen.paragraph(s.legend.join(" · "), x, y + 0.6, w, S.hint);
      break;
    }
    case "statTable":
      y = drawStatTable(pen, s, x, y, w);
      break;
    case "list": {
      for (const item of s.items) {
        pen.text(item, x + 1, y + 4.3, pen.fit(item, S.body, w - 2));
        pen.line(x, y + 6, x + w, y + 6, 0.3, "#BBB");
        y += 6;
      }
      for (let i = 0; i < s.blankLines; i++) {
        pen.line(x, y + 6, x + w, y + 6, 0.4, "#999");
        y += 6;
      }
      y += 0.5;
      break;
    }
    case "answers": {
      for (const row of s.rows) {
        pen.text(row.label, x, y + 3.4, pen.fit(row.label, S.fieldName, w));
        y += 4.4;
        if (row.text === "") {
          pen.line(x, y + 5, x + w, y + 5, 0.4, "#999");
          y += 6.5;
        } else {
          y = pen.paragraph(row.text, x, y, w, S.body) + 2;
        }
      }
      break;
    }
    case "helpBox": {
      const inner = w - 6;
      const start = y;
      let py = y + 2.5;
      for (const p of s.paragraphs.flatMap(steps)) py = pen.paragraph(p, x + 3, py, inner, S.small) + 1.5;
      const h = Math.max(py - start + 1, 12);
      pen.rect(x, start, w, h, { stroke: "#777", width: 0.4, radius: 1.5 });
      y = start + h;
      break;
    }
    case "notes":
      for (let i = 0; i < s.lines; i++) pen.line(x, y + 6 * (i + 1), x + w, y + 6 * (i + 1), 0.4, "#999");
      y += 6 * s.lines + 0.5;
      break;
  }
  y = hint(pen, s.hint, x, y, w);
  return y - top;
}

/**
 * A row per thing: its name, then one column per stat. Each column is as
 * wide as its label and longest entry need, so a number or a dice roll is
 * never broken; what is left goes to the names.
 */
function drawStatTable(
  pen: Pen,
  s: Extract<SheetSection, { kind: "statTable" }>,
  x: number,
  y: number,
  w: number,
): number {
  const gap = 2.5;
  const natural = s.columns.map((label, i) =>
    Math.max(pen.width(label, S.cardLabel), ...s.rows.map((r) => pen.width(r.cells[i]!, S.fieldName))),
  );
  const minName = Math.min(28, w * 0.3);
  const room = w - minName - s.columns.length * gap;
  const scale = Math.min(1, room / natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((n) => n * scale);
  const nameW = w - widths.reduce((a, b) => a + b, 0) - s.columns.length * gap;
  const left = widths.map((_, i) => x + nameW + gap + widths.slice(0, i).reduce((a, b) => a + b + gap, 0));
  const labels = s.columns.map((label, i) => pen.label(label, S.cardLabel, widths[i]!));
  const labelLh = pen.lineHeight(S.cardLabel, 1.15);
  labels.forEach((l, i) => l.lines.forEach((t, j) => pen.text(t, left[i]!, y + 2.5 + j * labelLh, l.style)));
  y += 1 + Math.max(1, ...labels.map((l) => l.lines.length)) * labelLh;
  pen.line(x, y, x + w, y, 0.5, "#777");
  for (const row of s.rows) {
    const top = y + 0.8;
    let bottom = pen.lines(pen.wrap(row.name, S.fieldName, nameW - 1), x, top, S.fieldName, 1.2);
    row.cells.forEach((cell, i) => {
      bottom = Math.max(
        bottom,
        pen.lines(pen.wrap(cell, S.fieldName, widths[i]!), left[i]!, top, S.fieldName, 1.2),
      );
    });
    y = bottom + 1.4;
    pen.line(x, y, x + w, y, 0.3, "#BBB");
    y += 0.6;
  }
  return y;
}

/** A help text written as "1. … 2. …" in one string is printed one step per line. */
function steps(text: string): string[] {
  return text.split(/\s+(?=\d{1,2}\.\s)/u);
}

function drawHeader(
  pen: Pen,
  s: Extract<SheetSection, { kind: "header" }>,
  x: number,
  y: number,
  w: number,
): number {
  const side = Math.min(60, w * 0.35);
  pen.text(s.name, x, y + 8, pen.fit(s.name, S.name, w - side - 4, 14));
  pen.text(s.summary, x, y + 14.5, pen.fit(s.summary, S.summary, w - side - 4, 8));
  pen.text(s.packageName, x + w, y + 4, pen.fit(s.packageName, S.meta, side), "right");
  pen.text(pen.messages.playedBy, x + w - side, y + 11.5, S.meta);
  pen.line(x + w - side, y + 15, x + w, y + 15, 0.4, "#777");
  pen.line(x, y + 18.5, x + w, y + 18.5, 1);
  return 19;
}

function drawStatBoxes(pen: Pen, boxes: StatBox[], x: number, y: number, w: number): number {
  const n = boxes.length;
  const bw = (w - (n - 1) * 4) / n;
  const hints = boxes.map((b) => pen.wrap(b.hint, S.hint, bw - 3).filter((l) => l !== ""));
  // Labels and hints are never cut: all boxes grow to the longest one.
  const labels = boxes.map((b) => pen.label(b.label, S.sectionTitle, bw - 3));
  const labelLh = pen.lineHeight(S.sectionTitle, 1.15);
  const extra = (Math.max(1, ...labels.map((l) => l.lines.length)) - 1) * labelLh;
  const h = 22.5 + extra + Math.max(1, ...hints.map((l) => l.length)) * 2.7;
  boxes.forEach((b, i) => {
    const bx = x + i * (bw + 4);
    const mid = bx + bw / 2;
    pen.rect(bx, y, bw, h, { width: 0.8, radius: 1.5 });
    const label = labels[i]!;
    label.lines.forEach((l, j) => pen.text(l, mid, y + 5 + j * labelLh, label.style, "center"));
    const top = y + extra;
    if (b.style === "pencil") {
      // The field says what goes in it, small in its corner: a word in the
      // middle read as a value that had been left out.
      const fx = bx + 5;
      const fw = bw - 10;
      pen.rect(fx, top + 8, fw, 11, { stroke: "#777", width: 0.4, radius: 1 });
      const what = pen.label(pen.messages.pencil, { size: 7, color: "#555" }, fw - 2);
      what.lines.forEach((l, j) => pen.text(l, fx + 1, top + 10.6 + j * 2.6, what.style));
    } else if (b.style === "circles") {
      // The number as well as the circles: how many is read at a glance, the circles are for ticking.
      pen.text(b.text, mid, top + 13.2, pen.fit(b.text, S.circlesValue, bw - 4, 12), "center");
      const step = Math.min(5.5, (bw - 6) / Math.max(1, b.circles));
      const r = Math.min(1.9, step * 0.38);
      for (let c = 0; c < b.circles; c++)
        pen.circle(mid + (c - (b.circles - 1) / 2) * step, top + 17.9, r, { width: 0.6 });
    } else {
      pen.text(b.text, mid, top + 18, pen.fit(b.text, S.bigValue, bw - 4, 12), "center");
    }
    hints[i]!.forEach((l, j) => pen.text(l, mid, top + 23.8 + j * 2.7, S.hint, "center"));
  });
  return y + h;
}

export interface Placed {
  section: SheetSection;
  x: number;
  /** Top on its page. */
  y: number;
  w: number;
}

const CONTINUATION_HEADER_H = 9;
const MIN_NOTE_LINES = 3;
/** Fewest rows a split section leaves at the bottom of a page; fewer start the next page. */
const MIN_SPLIT_ROWS = 2;
/**
 * Free space at the bottom of a page, in mm, above which a section that does
 * not fit is split rather than moved whole to the next page: a third of a
 * page left white reads as the end of the sheet.
 */
const MAX_PAGE_GAP = 85;

/** How many rows a section can be split between; 0 for a section that is one box. */
function partCount(s: SheetSection): number {
  switch (s.kind) {
    case "header":
    case "statBoxes":
      return 0;
    case "scoreColumn":
      return s.scores.length;
    case "checkList":
      return s.items.length;
    case "featureTable":
    case "statTable":
    case "answers":
      return s.rows.length;
    case "list":
      return s.items.length + s.blankLines;
    case "helpBox":
      return s.paragraphs.flatMap(steps).length;
    case "notes":
      return s.lines;
  }
}

/**
 * The first `n` rows of a section and the rest. The hint stays with the
 * last part, which carries the title marked as continued.
 */
function splitSection(s: SheetSection, n: number, m: Messages): [SheetSection, SheetSection] {
  const head = { ...s, hint: "" };
  const marker = ` (${m.continued})`;
  const tail = { ...s, title: s.title === "" || s.title.endsWith(marker) ? s.title : s.title + marker };
  switch (s.kind) {
    case "header":
    case "statBoxes":
      throw new Error(`a ${s.kind} section cannot be split`);
    case "scoreColumn":
      return [
        { ...head, kind: s.kind, scores: s.scores.slice(0, n) },
        { ...tail, kind: s.kind, scores: s.scores.slice(n) },
      ];
    case "checkList":
      return [
        { ...head, kind: s.kind, items: s.items.slice(0, n) },
        { ...tail, kind: s.kind, items: s.items.slice(n) },
      ];
    case "featureTable":
      // The lead stays above the first rows, the legend under the last ones, like the hint.
      return [
        { ...head, kind: s.kind, lead: s.lead, rows: s.rows.slice(0, n), legend: [] },
        { ...tail, kind: s.kind, lead: [], rows: s.rows.slice(n), legend: s.legend },
      ];
    case "statTable":
      return [
        { ...s, hint: "", rows: s.rows.slice(0, n) },
        { ...s, title: tail.title, rows: s.rows.slice(n) },
      ];
    case "answers":
      return [
        { ...head, kind: s.kind, rows: s.rows.slice(0, n) },
        { ...tail, kind: s.kind, rows: s.rows.slice(n) },
      ];
    case "list": {
      const items = Math.min(n, s.items.length);
      return [
        { ...head, kind: s.kind, items: s.items.slice(0, items), blankLines: n - items },
        { ...tail, kind: s.kind, items: s.items.slice(items), blankLines: s.blankLines - (n - items) },
      ];
    }
    case "helpBox": {
      const paragraphs = s.paragraphs.flatMap(steps);
      return [
        { ...head, kind: s.kind, paragraphs: paragraphs.slice(0, n) },
        { ...tail, kind: s.kind, paragraphs: paragraphs.slice(n) },
      ];
    }
    case "notes":
      return [
        { ...head, kind: s.kind, lines: n },
        { ...tail, kind: s.kind, lines: s.lines - n },
      ];
  }
}

/**
 * Places the sections on the 12-column grid, top to bottom (print layout
 * 2.1). A section goes into the columns where it can start highest, but
 * never above the section before it, so the sheet still reads in package
 * order; a short section next to a tall one moves up into the free space
 * instead of leaving a gap. A section that does not fit the page starts the
 * next one: pages break between sections, never inside a box. Only a section
 * taller than a whole page, or one whose move would leave more than
 * MAX_PAGE_GAP white, is split, between its rows, and goes on on the next
 * page under its title marked as continued; nothing is ever cut off.
 */
function placeSections(pen: Pen, sections: SheetSection[], bottom: number): Placed[][] {
  const pages: Placed[][] = [[]];
  const pageTop = (n: number) => MARGIN + (n > 0 ? CONTINUATION_HEADER_H : 0);
  let floor = new Array<number>(12).fill(pageTop(0));
  let previousY = pageTop(0);
  const measure = (section: SheetSection, w: number) => {
    pen.dry = true;
    const height = drawSection(pen, section, 0, 0, w);
    pen.dry = false;
    return height;
  };
  /** The most rows of `section` that fit into `room`, split off; null if not even the minimum fits. */
  const splitToFit = (section: SheetSection, w: number, room: number, min: number) => {
    const parts = partCount(section);
    let lo = Math.min(min, parts - 1);
    if (lo < 1 || measure(splitSection(section, lo, pen.messages)[0], w) > room) return null;
    let hi = parts - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(splitSection(section, mid, pen.messages)[0], w) <= room) lo = mid;
      else hi = mid - 1;
    }
    return splitSection(section, lo, pen.messages);
  };
  const queue = [...sections];
  while (queue.length > 0) {
    let section = queue.shift()!;
    let span = Math.min(12, section.span);
    let w = span * COLUMN_W + (span - 1) * COLUMN_GAP;
    let height = measure(section, w);
    const place = () => {
      let best = { col: 0, y: Infinity };
      for (let col = 0; col + span <= 12; col++) {
        const y = Math.max(previousY, ...floor.slice(col, col + span));
        if (y < best.y) best = { col, y };
      }
      return best;
    };
    let spot = place();
    // Blank note lines are the one thing that may shrink: a few fewer lines beat a page of its own.
    if (section.kind === "notes" && spot.y + height > bottom) {
      const fit = section.lines - Math.ceil((spot.y + height - bottom) / 6);
      if (fit >= MIN_NOTE_LINES) {
        section = { ...section, lines: fit };
        height = measure(section, w);
      }
    }
    // Taller than a whole page, or moving it would leave a large part of
    // this page white: what fits here stays (at least a few rows, else it
    // starts the next page), the rest goes on after it.
    const keep = (split: [SheetSection, SheetSection] | null) => {
      if (!split) return;
      section = split[0];
      height = measure(section, w);
      queue.unshift(split[1]);
    };
    if (
      spot.y + height > bottom &&
      (height > bottom - pageTop(1) || (section.kind !== "notes" && bottom - spot.y > MAX_PAGE_GAP))
    )
      keep(splitToFit(section, w, bottom - spot.y, MIN_SPLIT_ROWS));
    if (spot.y + height > bottom && pages.at(-1)!.length > 0) {
      pages.push([]);
      floor = new Array<number>(12).fill(pageTop(pages.length - 1));
      previousY = pageTop(pages.length - 1);
      // Notes that end the sheet alone on a new page take the whole page
      // (print layout 2.1): a small box on an empty page looks broken.
      if (section.kind === "notes" && queue.length === 0) {
        span = 12;
        w = CONTENT_W;
        const frame = measure({ ...section, lines: 0 }, w);
        section = {
          ...section,
          lines: Math.max(MIN_NOTE_LINES, Math.floor((bottom - previousY - frame) / 6)),
        };
        height = measure(section, w);
      }
      spot = place();
    }
    if (spot.y + height > bottom) keep(splitToFit(section, w, bottom - spot.y, 1));
    pages.at(-1)!.push({ section, x: MARGIN + spot.col * (COLUMN_W + COLUMN_GAP), y: spot.y, w });
    for (let c = spot.col; c < spot.col + span; c++) floor[c] = spot.y + height + ROW_GAP;
    previousY = spot.y;
  }
  return pages;
}

// ------------------------------------------------------------------ cards

interface CardFace {
  typeLine: string;
  name: string;
  fields: Card["fields"];
  table: string;
  rules: string[];
  rulesSize: number;
  /** Rules continue on the next card. */
  continues: boolean;
  uses: Uses;
  /** The kind's hint, as wrapped lines above the footer. */
  hint: string[];
}

const CARD_INNER_W = CARD_W - 2 * CARD_PAD;
const CARD_HEAD_BOTTOM = 16;
const FIELD_ROW_H = 8.5;
const CARD_RULES_BOTTOM = CARD_H - CARD_PAD - 6;
/** A card hint longer than this many lines is cut with "…": it must never crowd out the rules. */
const CARD_HINT_LINES = 2;
const CARD_HINT_LEAD = 1.15;

interface FieldLayout {
  label: { style: TextStyle; lines: string[] };
  value: { style: TextStyle; lines: string[] };
  /** Top of its row, relative to the top of the fields block. */
  top: number;
  /** Left edge, relative to the card's inner left edge. */
  left: number;
}

/** Lines a value may take in half the card before it gets the whole width. */
const HALF_FIELD_LINES = 2;

/**
 * The fields in two columns. A value too long for its column is wrapped in
 * it, not shrunk below 8 pt and never run into the next column or card; its
 * row grows instead. A value that would need more than HALF_FIELD_LINES
 * lines there takes a row of its own across the card: a sentence squeezed
 * into half the width grew the card's head so much that "at the table" ran
 * into the footer.
 */
function cardFields(pen: Pen, fields: Card["fields"]): { fields: FieldLayout[]; height: number } {
  const half = CARD_INNER_W / 2;
  const cw = half - 1;
  const laid = fields.map((f) => {
    const narrow = pen.label(f.value, S.cardValue, cw, 8);
    const wide = narrow.lines.length > HALF_FIELD_LINES;
    const w = wide ? CARD_INNER_W : cw;
    return {
      label: pen.label(f.label, S.cardLabel, w),
      value: wide ? pen.label(f.value, S.cardValue, w, 8) : narrow,
      wide,
    };
  });
  const extra = (l: (typeof laid)[number]) =>
    (l.label.lines.length - 1) * pen.lineHeight(l.label.style, 1.15) +
    (l.value.lines.length - 1) * pen.lineHeight(l.value.style, 1.15);
  const rows: (typeof laid)[] = [];
  for (const l of laid) {
    const last = rows.at(-1);
    if (last && last.length === 1 && !last[0]!.wide && !l.wide) last.push(l);
    else rows.push([l]);
  }
  const out: FieldLayout[] = [];
  let top = 0;
  for (const row of rows) {
    row.forEach(({ wide: _, ...l }, i) => out.push({ ...l, top, left: i * half }));
    top += FIELD_ROW_H + Math.max(...row.map(extra));
  }
  return { fields: out, height: fields.length === 0 ? 0 : top + 4 };
}

/** Top of the "at the table" block and of the rules block, relative to the card. */
function cardBlocks(pen: Pen, face: Pick<CardFace, "fields" | "table">): { rulesTop: number } {
  let y = CARD_HEAD_BOTTOM;
  y += cardFields(pen, face.fields).height;
  if (face.table !== "") {
    y += 4.5;
    y += pen.wrap(face.table, S.cardTable, CARD_INNER_W).length * pen.lineHeight(S.cardTable, CARD_LEAD) + 1;
  }
  // "Rules text" heading
  return { rulesTop: y + 4.2 };
}

/** The kind's hint in at most `CARD_HINT_LINES` lines; the last one ends in "…" if the text goes on. */
function cardHint(pen: Pen, hint: string): string[] {
  if (hint === "") return [];
  const lines = pen.wrap(hint, S.hint, CARD_INNER_W);
  if (lines.length <= CARD_HINT_LINES) return lines;
  const kept = lines.slice(0, CARD_HINT_LINES);
  let last = kept.at(-1)!;
  while (last.length > 0 && pen.width(`${last}…`, S.hint) > CARD_INNER_W) last = last.slice(0, -1);
  kept[kept.length - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** Height the hint takes above the footer line, gap included. */
function cardHintHeight(pen: Pen, hint: string[]): number {
  return hint.length === 0 ? 0 : hint.length * pen.lineHeight(S.hint, CARD_HINT_LEAD) + 1;
}

/**
 * One card per thing, or more if the rules text does not fit even at 7 pt
 * (print layout 3.3): the first card ends with "continues on the next
 * card", continuation cards carry only the rules. "At the table" is never
 * shortened or moved. The kind's hint is on every card, continuations
 * included, and takes its room from the rules.
 */
function cardFaces(pen: Pen, card: Card, messages: Messages): CardFace[] {
  const hint = cardHint(pen, card.hint);
  const { rulesTop } = cardBlocks(pen, card);
  // "At the table" is never cut or moved; where it reaches down to the
  // hint, the hint gives way on this card (continuation cards still have it).
  const firstHint = rulesTop - 4.2 > CARD_RULES_BOTTOM - cardHintHeight(pen, hint) ? [] : hint;
  const base: CardFace = {
    ...card,
    hint: firstHint,
    rules: [],
    rulesSize: RULES_SIZES[0]!,
    continues: false,
  };
  const text = card.rules.join("\n");
  if (text === "") return [base];
  const rulesBottom = CARD_RULES_BOTTOM - cardHintHeight(pen, firstHint);
  const room = rulesBottom - rulesTop;
  for (const size of RULES_SIZES) {
    const style = { size };
    const lines = pen.wrap(text, style, CARD_INNER_W);
    if (lines.length * pen.lineHeight(style, CARD_LEAD) <= room)
      return [{ ...base, rules: lines, rulesSize: size }];
  }
  const style = { size: 7 };
  const lh = pen.lineHeight(style, CARD_LEAD);
  const lines = pen.wrap(text, style, CARD_INNER_W);
  const first = Math.max(0, Math.floor((room - lh) / lh));
  // Every card that continues keeps one line free for "continues on the next card".
  const laterBottom = CARD_RULES_BOTTOM - cardHintHeight(pen, hint);
  const later = Math.floor((laterBottom - (CARD_HEAD_BOTTOM + 4.2) - lh) / lh);
  const chunks = [lines.slice(0, first)];
  for (let i = first; i < lines.length; i += later) chunks.push(lines.slice(i, i + later));
  const n = chunks.length;
  return chunks.map((chunk, i) =>
    i === 0
      ? { ...base, rules: chunk, rulesSize: 7, continues: true }
      : {
          typeLine: messages.continued,
          name: `${card.name} (${i + 1}/${n})`,
          fields: [],
          table: "",
          rules: chunk,
          rulesSize: 7,
          continues: i < n - 1,
          uses: null,
          hint,
        },
  );
}

function drawCard(pen: Pen, face: CardFace, model: PrintModel, x: number, y: number): void {
  const m = model.messages;
  const left = x + CARD_PAD;
  pen.rect(x, y, CARD_W, CARD_H, { stroke: "#999", width: 0.3 });
  pen.text(face.typeLine, left, y + CARD_PAD + 3.8, pen.fit(face.typeLine, S.cardType, CARD_INNER_W));
  pen.text(face.name, left, y + CARD_PAD + 9.5, pen.fit(face.name, S.cardName, CARD_INNER_W, 8));
  pen.line(left, y + CARD_HEAD_BOTTOM, x + CARD_W - CARD_PAD, y + CARD_HEAD_BOTTOM, 0.6);
  let yy = y + CARD_HEAD_BOTTOM;
  if (face.fields.length > 0) {
    const { fields, height } = cardFields(pen, face.fields);
    fields.forEach((f) => {
      const fx = left + f.left;
      const fy = yy + 4 + f.top;
      const labelLh = pen.lineHeight(f.label.style, 1.15);
      const valueLh = pen.lineHeight(f.value.style, 1.15);
      f.label.lines.forEach((l, i) => pen.text(l, fx, fy + i * labelLh, f.label.style));
      const valueTop = fy + 4.2 + (f.label.lines.length - 1) * labelLh;
      f.value.lines.forEach((l, i) => pen.text(l, fx, valueTop + i * valueLh, f.value.style));
    });
    yy += height;
    pen.line(left, yy - 1, x + CARD_W - CARD_PAD, yy - 1, 0.3, "#BBB");
  }
  if (face.table !== "") {
    pen.text(m.atTheTable, left, yy + 3.5, S.cardHeading);
    yy = pen.paragraph(face.table, left, yy + 4.5, CARD_INNER_W, S.cardTable, CARD_LEAD) + 1;
  }
  if (face.rules.length > 0) {
    pen.text(m.rulesText, left, yy + 3.2, { ...S.cardHeading, color: "#333" });
    yy = pen.lines(face.rules, left, yy + 4.2, { size: face.rulesSize, color: "#222" }, CARD_LEAD);
    if (face.continues) pen.text(`→ ${m.continuesOnNextCard}`, left, yy + 2.8, S.hint);
  }
  const footY = y + CARD_H - CARD_PAD - 5;
  pen.lines(face.hint, left, footY - cardHintHeight(pen, face.hint), S.hint, CARD_HINT_LEAD);
  pen.line(left, footY, x + CARD_W - CARD_PAD, footY, 0.3, "#BBB");
  const owner = `${model.name} · ${model.levelLabel}`;
  const footBase = y + CARD_H - CARD_PAD - 1;
  const usesW = usesWidth(pen, face.uses, S.footer);
  drawUses(pen, face.uses, x + CARD_W - CARD_PAD, footBase, S.footer);
  pen.text(owner, left, footBase, pen.fit(owner, S.footer, CARD_INNER_W - (usesW > 0 ? usesW + 2 : 0)));
}

/** Crop marks outside the grid, only as far as there are cards (print layout 3.1). */
function cropMarks(pen: Pen, count: number): void {
  const rows = Math.ceil(count / 3);
  const cols = (r: number) => (r < 0 || r >= rows ? 0 : Math.min(3, count - r * 3));
  for (let r = 0; r <= rows; r++) {
    const y = GRID_Y + r * CARD_H;
    const right = GRID_X + Math.max(cols(r - 1), cols(r)) * CARD_W;
    pen.line(GRID_X - CROP_GAP - CROP_LEN, y, GRID_X - CROP_GAP, y);
    pen.line(right + CROP_GAP, y, right + CROP_GAP + CROP_LEN, y);
  }
  for (let c = 0; c <= cols(0); c++) {
    const x = GRID_X + c * CARD_W;
    pen.line(x, GRID_Y - CROP_GAP - CROP_LEN, x, GRID_Y - CROP_GAP);
    let last = 0;
    for (let r = 0; r < rows; r++) if (cols(r) >= Math.max(c, 1)) last = r;
    const bottom = GRID_Y + (last + 1) * CARD_H;
    pen.line(x, bottom + CROP_GAP, x, bottom + CROP_GAP + CROP_LEN);
  }
}

// ------------------------------------------------------------------ document

export interface RenderedPdf {
  bytes: Uint8Array<ArrayBuffer>;
  pages: number;
  sheetPages: number;
  cardPages: number;
  /** Where each sheet section ended up, per sheet page, in mm. */
  sheetLayout: Placed[][];
}

/** The character sheet followed by the cards, as one A4 PDF. */
export async function renderPdf(model: PrintModel): Promise<RenderedPdf> {
  const fonts: Record<FontName, string> = {
    regular: fileURLToPath(FONTS.regular),
    semibold: fileURLToPath(FONTS.semibold),
    bold: fileURLToPath(FONTS.bold),
  };
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    pdfVersion: "1.7",
    subset: "PDF/A-2b",
    lang: model.language,
    displayTitle: true,
    font: fonts.regular,
    info: {
      Title: model.name,
      Creator: "Character Builder",
      Producer: "Character Builder",
      CreationDate: model.createdAt,
      ModDate: model.createdAt,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const pen = new Pen(doc, model.language, model.messages, fonts);
  const m = model.messages;

  // The source and license line is wrapped, never cut; on the sheet it needs
  // room above the footer if the sheet's last page is the document's last.
  const attributionLh = pen.lineHeight(S.footer, 1.2);
  const sheetAttribution = pen.wrap(model.attribution, S.footer, CONTENT_W).filter((l) => l !== "");
  const cardAttribution = pen.wrap(model.attribution, S.footer, PAGE_W - 2 * GRID_X).filter((l) => l !== "");
  const sheetBottom =
    CONTENT_BOTTOM -
    (model.cards.length === 0 && sheetAttribution.length > 0
      ? sheetAttribution.length * attributionLh + 2
      : 0);
  const sheetPages = placeSections(pen, model.sections, sheetBottom);
  const faces = model.cards.flatMap((c) => cardFaces(pen, c, m));
  const cardPages = Math.ceil(faces.length / CARDS_PER_PAGE);
  const total = sheetPages.length + cardPages;
  const isLast = (page: number) => page === total;

  sheetPages.forEach((placed, i) => {
    const page = i + 1;
    doc.addPage({ size: "A4", margin: 0 });
    if (i > 0) {
      pen.text(`${model.name} · ${model.levelLabel}`, MARGIN, MARGIN + 4, S.fieldName);
      pen.line(MARGIN, MARGIN + 6, MARGIN + CONTENT_W, MARGIN + 6, 0.6);
    }
    for (const p of placed) drawSection(pen, p.section, p.x, p.y, p.w);
    if (isLast(page))
      pen.lines(
        sheetAttribution,
        MARGIN,
        FOOTER_LINE_Y - 1.5 - sheetAttribution.length * attributionLh,
        S.footer,
        1.2,
      );
    pen.line(MARGIN, FOOTER_LINE_Y, MARGIN + CONTENT_W, FOOTER_LINE_Y, 0.3, "#999");
    const footer = [model.name, model.levelLabel, model.unitsLine, m.page(page, total)].join(" · ");
    pen.text(footer, MARGIN, PAGE_H - MARGIN, pen.fit(footer, S.footer, CONTENT_W - 40));
    pen.text(model.createdOn, MARGIN + CONTENT_W, PAGE_H - MARGIN, S.footer, "right");
  });

  for (let p = 0; p < cardPages; p++) {
    const page = sheetPages.length + p + 1;
    doc.addPage({ size: "A4", margin: 0 });
    const onPage = faces.slice(p * CARDS_PER_PAGE, (p + 1) * CARDS_PER_PAGE);
    const head = [m.cards, model.name, m.page(page, total)].join(" · ");
    pen.text(head, GRID_X, 8.5, pen.fit(head, S.meta, 80));
    pen.text(m.printHint, PAGE_W - GRID_X, 8.5, pen.fit(m.printHint, S.meta, 105), "right");
    onPage.forEach((face, i) =>
      drawCard(pen, face, model, GRID_X + (i % 3) * CARD_W, GRID_Y + Math.floor(i / 3) * CARD_H),
    );
    cropMarks(pen, onPage.length);
    if (isLast(page))
      pen.lines(
        cardAttribution,
        GRID_X,
        PAGE_H - 4.5 - cardAttribution.length * attributionLh,
        S.footer,
        1.2,
      );
  }

  doc.end();
  await done;
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    pages: total,
    sheetPages: sheetPages.length,
    cardPages,
    sheetLayout: sheetPages,
  };
}
