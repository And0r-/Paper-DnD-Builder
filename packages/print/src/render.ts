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
import type { Card, PrintModel, SheetSection, StatBox } from "./model.ts";

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

const FONT_FILES = {
  regular: "AtkinsonHyperlegibleNext-Regular.ttf",
  semibold: "AtkinsonHyperlegibleNext-SemiBold.ttf",
  bold: "AtkinsonHyperlegibleNext-Bold.ttf",
} as const;
type FontName = keyof typeof FONT_FILES;

const fontPath = (file: string) => fileURLToPath(new URL(`../fonts/${file}`, import.meta.url));

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

  constructor(doc: PDFKit.PDFDocument, language: string, messages: Messages) {
    this.doc = doc;
    this.language = language;
    this.messages = messages;
  }

  private prepare(s: TextStyle): string {
    this.doc.font(s.font ?? "regular").fontSize(s.size);
    return s.color ?? "#000";
  }

  private shown(text: string, s: TextStyle): string {
    return s.caps ? text.toLocaleUpperCase(this.language) : text;
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

  /** Breaks text into lines no wider than `width`. Words longer than a line are split. */
  wrap(text: string, s: TextStyle, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/u).filter((w) => w !== "")) {
        const candidate = line === "" ? word : `${line} ${word}`;
        if (this.width(candidate, s) <= width) {
          line = candidate;
          continue;
        }
        if (line !== "") lines.push(line);
        line = word;
        while (this.width(line, s) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && this.width(line.slice(0, cut), s) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines;
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
  scoreValue: { font: "bold", size: 20 },
  fieldName: { font: "bold", size: 9 },
  body: { size: 9 },
  small: { size: 8.5 },
  hint: { size: 7, color: "#333" },
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
        const h = 19;
        pen.rect(x, y, w, h, { width: 0.7, radius: 1.5 });
        pen.text(sc.label, x + 3, y + 5, pen.fit(sc.label, S.fieldName, w - 25));
        pen.text(sc.value, x + 3, y + 15.5, pen.fit(sc.value, S.scoreValue, w - 25, 12));
        if (sc.derived !== null) {
          const cx = x + w - 11;
          pen.circle(cx, y + 11.5, 6.3, { width: 0.7 });
          pen.text(sc.derived, cx, y + 13.7, pen.fit(sc.derived, { font: "bold", size: 12 }, 11), "center");
          pen.text(sc.derivedLabel, x + w - 2, y + 3.4, pen.fit(sc.derivedLabel, S.hint, w - 24), "right");
        }
        y += h + 3;
      }
      y -= 3;
      break;
    case "checkList": {
      const columns = w >= 90 ? 2 : 1;
      const cw = (w - (columns - 1) * 4) / columns;
      const rows = Math.ceil(s.items.length / columns);
      s.items.forEach((item, i) => {
        const cx = x + (i % columns) * (cw + 4);
        const cy = y + 4.5 + Math.floor(i / columns) * 7;
        pen.circle(cx + 2, cy - 1.3, 1.6, { fill: item.marked });
        pen.text(item.name, cx + 5.5, cy, pen.fit(item.name, S.body, cw - 15));
        pen.rect(cx + cw - 7.5, cy - 4.2, 7, 5.5, { width: 0.5, radius: 0.8 });
      });
      y += rows * 7;
      break;
    }
    case "featureTable": {
      const nameW = Math.min(36, w * 0.36);
      for (const row of s.rows) {
        const nameLines = pen.wrap(row.name, S.fieldName, nameW - 2);
        const textLines = pen.wrap(row.text, S.small, w - nameW);
        const nameBottom = pen.lines(nameLines, x, y + 0.8, S.fieldName, 1.2);
        const textBottom = pen.lines(textLines, x + nameW, y + 0.9, S.small, 1.25);
        y = Math.max(nameBottom, textBottom) + 1.4;
        pen.line(x, y, x + w, y, 0.3, "#BBB");
        y += 0.6;
      }
      break;
    }
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
  // Hints are never cut: all boxes grow to the longest one.
  const h = 22.5 + Math.max(1, ...hints.map((l) => l.length)) * 2.7;
  boxes.forEach((b, i) => {
    const bx = x + i * (bw + 4);
    const mid = bx + bw / 2;
    pen.rect(bx, y, bw, h, { width: 0.8, radius: 1.5 });
    pen.text(b.label, mid, y + 5, pen.fit(b.label, S.sectionTitle, bw - 3), "center");
    if (b.style === "pencil") {
      pen.rect(bx + 5, y + 8, bw - 10, 11, { stroke: "#777", width: 0.4, radius: 1 });
      pen.text(pen.messages.pencil, mid, y + 14.8, { size: 7, color: "#555" }, "center");
    } else if (b.style === "circles") {
      const step = Math.min(8, (bw - 6) / Math.max(1, b.circles));
      const r = Math.min(2.8, step * 0.38);
      for (let c = 0; c < b.circles; c++)
        pen.circle(mid + (c - (b.circles - 1) / 2) * step, y + 13.5, r, { width: 0.7 });
    } else {
      pen.text(b.text, mid, y + 18, pen.fit(b.text, S.bigValue, bw - 4, 12), "center");
    }
    hints[i]!.forEach((l, j) => pen.text(l, mid, y + 23.8 + j * 2.7, S.hint, "center"));
  });
  return y + h;
}

interface Placed {
  section: SheetSection;
  x: number;
  /** Top on its page. */
  y: number;
  w: number;
}

const CONTINUATION_HEADER_H = 9;
const MIN_NOTE_LINES = 3;

/**
 * Places the sections on the 12-column grid, top to bottom (print layout
 * 2.1). A section goes into the columns where it can start highest, but
 * never above the section before it, so the sheet still reads in package
 * order; a short section next to a tall one moves up into the free space
 * instead of leaving a gap. A section that does not fit the page starts the
 * next one: pages break between sections, never inside a box.
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
  for (let section of sections) {
    const span = Math.min(12, section.span);
    const w = span * COLUMN_W + (span - 1) * COLUMN_GAP;
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
    if (spot.y + height > bottom && pages.at(-1)!.length > 0) {
      pages.push([]);
      floor = new Array<number>(12).fill(pageTop(pages.length - 1));
      previousY = pageTop(pages.length - 1);
      spot = place();
    }
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
}

const CARD_INNER_W = CARD_W - 2 * CARD_PAD;
const CARD_HEAD_BOTTOM = 16;
const CARD_FIELDS_H = 21;
const CARD_RULES_BOTTOM = CARD_H - CARD_PAD - 6;

/** Top of the "at the table" block and of the rules block, relative to the card. */
function cardBlocks(pen: Pen, face: Pick<CardFace, "fields" | "table">): { rulesTop: number } {
  let y = CARD_HEAD_BOTTOM;
  if (face.fields.length > 0) y += CARD_FIELDS_H;
  if (face.table !== "") {
    y += 4.5;
    y += pen.wrap(face.table, S.cardTable, CARD_INNER_W).length * pen.lineHeight(S.cardTable, CARD_LEAD) + 1;
  }
  // "Rules text" heading
  return { rulesTop: y + 4.2 };
}

/**
 * One card per thing, or more if the rules text does not fit even at 7 pt
 * (print layout 3.3): the first card ends with "continues on the next
 * card", continuation cards carry only the rules. "At the table" is never
 * shortened or moved.
 */
function cardFaces(pen: Pen, card: Card, messages: Messages): CardFace[] {
  const base: CardFace = { ...card, rules: [], rulesSize: RULES_SIZES[0]!, continues: false };
  const text = card.rules.join("\n");
  if (text === "") return [base];
  const { rulesTop } = cardBlocks(pen, card);
  const room = CARD_RULES_BOTTOM - rulesTop;
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
  const later = Math.floor((CARD_RULES_BOTTOM - (CARD_HEAD_BOTTOM + 4.2) - lh) / lh);
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
    const cw = CARD_INNER_W / 2;
    face.fields.forEach((f, j) => {
      const fx = left + (j % 2) * cw;
      const fy = yy + 4 + Math.floor(j / 2) * 8.5;
      pen.text(f.label, fx, fy, pen.fit(f.label, S.cardLabel, cw - 1));
      pen.text(f.value, fx, fy + 4.2, pen.fit(f.value, S.cardValue, cw - 1));
    });
    yy += CARD_FIELDS_H;
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
  pen.line(left, footY, x + CARD_W - CARD_PAD, footY, 0.3, "#BBB");
  const owner = `${model.name} · ${model.levelLabel}`;
  pen.text(owner, left, y + CARD_H - CARD_PAD - 1, pen.fit(owner, S.footer, CARD_INNER_W));
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
  bytes: Uint8Array;
  pages: number;
  sheetPages: number;
  cardPages: number;
}

/** The character sheet followed by the cards, as one A4 PDF. */
export async function renderPdf(model: PrintModel): Promise<RenderedPdf> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    pdfVersion: "1.7",
    subset: "PDF/A-2b",
    lang: model.language,
    displayTitle: true,
    font: fontPath(FONT_FILES.regular),
    info: {
      Title: model.name,
      Creator: "Character Builder",
      Producer: "Character Builder",
      CreationDate: model.createdAt,
      ModDate: model.createdAt,
    },
  });
  for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, fontPath(file));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const pen = new Pen(doc, model.language, model.messages);
  const m = model.messages;

  // Room for the source and license line if the sheet's last page is the document's last.
  const sheetBottom = CONTENT_BOTTOM - (model.cards.length === 0 && model.attribution !== "" ? 8 : 0);
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
    if (isLast(page) && model.attribution !== "")
      pen.paragraph(model.attribution, MARGIN, FOOTER_LINE_Y - 7, CONTENT_W, S.footer, 1.2);
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
    if (isLast(page) && model.attribution !== "") {
      const style = pen.fit(model.attribution, S.footer, PAGE_W - 2 * GRID_X);
      pen.text(model.attribution, GRID_X, PAGE_H - 6.5, style);
    }
  }

  doc.end();
  await done;
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    pages: total,
    sheetPages: sheetPages.length,
    cardPages,
  };
}
