/**
 * Lays out a {@link SheetModel} on A4 and writes the PDF: the sheet in its
 * design (see `verbose.ts`, `classic.ts`), the cards and the rules texts.
 *
 * All measures are in millimetres. Cards are 63 × 88 mm in a 3 × 3 grid with
 * cut lines and crop marks; the rules texts run in two columns. Both look
 * the same in every design. The PDF is drawn with pdfkit: plain vector
 * drawing with the font embedded, so text stays extractable, sizes are
 * exact and the server needs no browser. The PDF has no links, no form
 * fields and no scripts, and it never refers to anything outside itself.
 */
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  DEFAULT_API_PARTS,
  inFileOrder,
  MESSAGES,
  SHEET_DESIGNS,
  type Card,
  type Messages,
  type PlayState,
  type PrintPart,
  type RulesGroup,
  type SheetModel,
  type Uses,
} from "@builder/sheet";
import { contentBottom, contentWidth, footerLine, type GridGeometry } from "@builder/sheet/designs";
import { CLASSIC_GEOMETRY } from "@builder/sheet/designs/classic";
import { VERBOSE_GEOMETRY } from "@builder/sheet/designs/verbose";
import { layClassic } from "./classic.ts";
import {
  drawUses,
  FONTS,
  Pen,
  S,
  sectionTitle,
  TITLE_H,
  usesWidth,
  type DrawnField,
  type FontName,
  type TextStyle,
} from "./pen.ts";
import { drawPlaced, gridStyles, placeSections, withWriting, type Grid, type Placed } from "./verbose.ts";

/**
 * The page of the parts that look the same in every design (rules texts):
 * that of the verbose grid.
 */
const PAGE = VERBOSE_GEOMETRY;
const PAGE_W = PAGE.page.width;
const PAGE_H = PAGE.page.height;
const MARGIN = PAGE.margin;
const CONTENT_W = contentWidth(PAGE);
const FOOTER_LINE_Y = footerLine(PAGE);
const CONTENT_BOTTOM = contentBottom(PAGE);

// Cards (print layout 3.1)
const CARD_W = 63;
const CARD_H = 88;
const GRID_X = (PAGE_W - 3 * CARD_W) / 2;
const GRID_Y = (PAGE_H - 3 * CARD_H) / 2;
const CARD_PAD = 4;
const CARDS_PER_PAGE = 9;
const CROP_GAP = 1.5;
const CROP_LEN = 4;

const RULES_SIZES = [7.5, 7.25, 7];
const CARD_LEAD = 1.25;

// ------------------------------------------------------------------ cards

/** A card field; `wide` takes a row of its own across the card. */
type CardField = Card["fields"][number] & { wide?: boolean };

interface CardFace {
  typeLine: string;
  name: string;
  fields: CardField[];
  table: string;
  rules: string[];
  rulesSize: number;
  /** Rules continue on the next card. */
  continues: boolean;
  uses: Uses;
  /** Field of the use boxes (the first card of a thing only). */
  usesField?: string | undefined;
  /** The kind's hint, as wrapped lines above the footer. */
  hint: string[];
}

const CARD_INNER_W = CARD_W - 2 * CARD_PAD;
const CARD_HEAD_BOTTOM = 16;
const FIELD_ROW_H = 8.5;
/** A wide field whose label and value fit on one line takes this much. */
const INLINE_ROW_H = 5.5;
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
  /** Label and value on one line: the value's left edge after the label. */
  inline?: number;
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
function cardFields(pen: Pen, fields: CardField[]): { fields: FieldLayout[]; height: number } {
  const half = CARD_INNER_W / 2;
  const cw = half - 1;
  const laid = fields.map((f) => {
    // A wide field that fits on one line, label then value, keeps the card's head short.
    const labelW = pen.width(f.label, S.cardLabel) + 2;
    if (f.wide === true && labelW + pen.width(f.value, S.cardValue) <= CARD_INNER_W)
      return {
        label: { style: S.cardLabel, lines: [f.label] },
        value: { style: S.cardValue, lines: [f.value] },
        wide: true,
        inline: labelW,
      };
    const narrow = pen.label(f.value, S.cardValue, cw, 8);
    const wide = f.wide === true || narrow.lines.length > HALF_FIELD_LINES;
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
    top += row[0]!.inline !== undefined ? INLINE_ROW_H : FIELD_ROW_H + Math.max(...row.map(extra));
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
 * shortened: where the fields and the origin line leave it too little room
 * above the hint, it moves whole to the first continuation card, the rules
 * after it (and the origin line before it, if the fields alone fill the card). The kind's hint is on every card, continuations included, and
 * takes its room from the rules; nothing is printed over it or the footer.
 */
function cardFaces(pen: Pen, card: Card, messages: Messages): CardFace[] {
  const hint = cardHint(pen, card.hint);
  // The origin line (the numbers the thing is used with, by where it came from) goes under the fields, across the card.
  const fields: CardField[] = card.origin ? [...card.fields, { ...card.origin, wide: true }] : card.fields;
  const base: CardFace = { ...card, fields, hint, rules: [], rulesSize: RULES_SIZES[0]!, continues: false };
  const rulesBottom = CARD_RULES_BOTTOM - cardHintHeight(pen, hint);
  const text = card.rules.join("\n");
  const { rulesTop } = cardBlocks(pen, { fields, table: card.table });
  // Everything on one card, the rules at the largest size that fits.
  if (rulesTop - 4.2 <= rulesBottom) {
    if (text === "") return [base];
    for (const size of RULES_SIZES) {
      const style = { size };
      const lines = pen.wrap(text, style, CARD_INNER_W);
      if (lines.length * pen.lineHeight(style, CARD_LEAD) <= rulesBottom - rulesTop)
        return [{ ...base, rules: lines, rulesSize: size }];
    }
  }
  const style = { size: 7 };
  const lh = pen.lineHeight(style, CARD_LEAD);
  const lines = text === "" ? [] : pen.wrap(text, style, CARD_INNER_W);
  // What stays on the first card has to leave a line for "continues on the
  // next card". "At the table" moves first; if the fields alone leave no
  // room, the origin line goes with it.
  const fits = (f: CardField[], table: string) =>
    cardBlocks(pen, { fields: f, table }).rulesTop - 4.2 + lh <= rulesBottom;
  const originMoves = card.origin !== undefined && !fits(fields, "");
  const firstFields = originMoves ? card.fields : fields;
  const tableStays = fits(firstFields, card.table);
  // The rules follow "at the table", never come before it.
  const firstTop = cardBlocks(pen, { fields: firstFields, table: card.table }).rulesTop;
  const first = tableStays ? Math.max(0, Math.floor((rulesBottom - firstTop - lh) / lh)) : 0;
  const chunks: { fields: CardField[]; table: string; rules: string[] }[] = [
    { fields: firstFields, table: tableStays ? card.table : "", rules: lines.slice(0, first) },
  ];
  // Every card that continues keeps one line free for "continues on the next card".
  let i = first;
  let carried: CardField[] = originMoves ? fields.slice(card.fields.length) : [];
  let table = tableStays ? "" : card.table;
  while (i < lines.length || table !== "" || carried.length > 0) {
    const room = rulesBottom - cardBlocks(pen, { fields: carried, table }).rulesTop;
    const all = Math.floor(room / lh);
    // A card carrying only rules takes at least one line, so the loop always ends.
    const least = table === "" && carried.length === 0 ? 1 : 0;
    const take = lines.length - i <= all ? lines.length - i : Math.max(least, Math.floor((room - lh) / lh));
    chunks.push({ fields: carried, table, rules: lines.slice(i, i + take) });
    i += take;
    carried = [];
    table = "";
  }
  const n = chunks.length;
  return chunks.map((chunk, i) =>
    i === 0
      ? { ...base, ...chunk, rulesSize: 7, continues: true }
      : {
          typeLine: messages.continued,
          name: `${card.name} (${i + 1}/${n})`,
          fields: chunk.fields,
          table: chunk.table,
          rules: chunk.rules,
          rulesSize: 7,
          continues: i < n - 1,
          uses: null,
          hint,
        },
  );
}

function drawCard(pen: Pen, face: CardFace, model: SheetModel, x: number, y: number): void {
  const m = pen.messages;
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
      if (f.inline !== undefined) {
        pen.text(f.label.lines[0]!, fx, fy + 0.6, f.label.style);
        pen.text(f.value.lines[0]!, fx + f.inline, fy + 0.6, f.value.style);
        return;
      }
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
  }
  if (face.continues) pen.text(`→ ${m.continuesOnNextCard}`, left, yy + 2.8, S.hint);
  const footY = y + CARD_H - CARD_PAD - 5;
  pen.lines(face.hint, left, footY - cardHintHeight(pen, face.hint), S.hint, CARD_HINT_LEAD);
  pen.line(left, footY, x + CARD_W - CARD_PAD, footY, 0.3, "#BBB");
  const owner = `${model.name} · ${model.levelLabel}`;
  const footBase = y + CARD_H - CARD_PAD - 1;
  const usesW = usesWidth(pen, face.uses, S.footer);
  drawUses(pen, face.uses, x + CARD_W - CARD_PAD, footBase, S.footer, face.usesField);
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

// ------------------------------------------------------------------ rules texts

// Rules texts to read up on: two columns of running text, no cut lines.
const TEXT_COLUMN_GAP = 6;
const TEXT_COLUMN_W = (CONTENT_W - TEXT_COLUMN_GAP) / 2;
const TEXTS_FIRST_TOP = MARGIN + 16;
const TEXTS_LATER_TOP = MARGIN + 10;

const T = {
  title: { font: "bold", size: 16 },
  entryName: { font: "bold", size: 9.5 },
  kind: { size: 7, caps: true, color: "#333", spacing: 0.06 },
  rules: { size: 8.5 },
  explain: { size: 8, color: "#333" },
} satisfies Record<string, TextStyle>;
const TEXT_LEAD = 1.3;

/**
 * One line or gap of the running text. `keep`: goes into the same column as
 * the row after it, so a heading or a name never ends a column alone.
 */
interface FlowRow {
  h: number;
  keep?: boolean;
  /** Room between blocks; dropped at the top of a column. */
  gap?: boolean;
  draw?: (pen: Pen, x: number, top: number) => void;
}

function textRows(pen: Pen, text: string, s: TextStyle): FlowRow[] {
  const h = pen.lineHeight(s, TEXT_LEAD);
  return pen
    .wrap(text, s, TEXT_COLUMN_W)
    .map((line) => ({ h, draw: (p: Pen, x: number, top: number) => p.lines([line], x, top, s, TEXT_LEAD) }));
}

/** The rules texts as rows: a heading per origin, then name, kind and paragraphs of each thing. */
function rulesRows(pen: Pen, groups: RulesGroup[]): FlowRow[] {
  const rows: FlowRow[] = [];
  for (const g of groups) {
    rows.push({ h: 4, gap: true });
    if (g.title !== "")
      rows.push({
        h: TITLE_H + 2,
        keep: true,
        draw: (p, x, top) => sectionTitle(p, g.title, x, top, TEXT_COLUMN_W),
      });
    for (const e of g.entries) {
      rows.push({ h: 2.5, gap: true });
      rows.push(...textRows(pen, e.name, T.entryName).map((r) => ({ ...r, keep: true })));
      if (e.kindName !== "")
        rows.push(...textRows(pen, e.kindName, T.kind).map((r) => ({ ...r, keep: true })));
      rows.push({ h: 0.8, gap: true, keep: true });
      e.rules.forEach((para, i) => {
        if (i > 0) rows.push({ h: 1.2, gap: true });
        rows.push(...textRows(pen, para, T.rules));
      });
      for (const para of e.explain) {
        rows.push({ h: 1.2, gap: true });
        rows.push(...textRows(pen, para, T.explain));
      }
    }
  }
  return rows;
}

interface FlowPlaced {
  row: FlowRow;
  x: number;
  y: number;
}

/** Fills the rows into two columns per page, top to bottom, left to right. */
function flowRows(rows: FlowRow[], bottom: number): FlowPlaced[][] {
  const pages: FlowPlaced[][] = [[]];
  let col = 0;
  const top = () => (pages.length === 1 ? TEXTS_FIRST_TOP : TEXTS_LATER_TOP);
  let y = top();
  const next = () => {
    col += 1;
    if (col === 2) {
      col = 0;
      pages.push([]);
    }
    y = top();
  };
  rows.forEach((row, i) => {
    if (row.gap) {
      if (y > top()) y += row.h;
      return;
    }
    // The row and every row it keeps with must fit, unless the column is empty anyway.
    let need = row.h;
    for (let j = i; rows[j]?.keep && j + 1 < rows.length; j++) need += rows[j + 1]!.h;
    if (y + need > bottom && y > top()) next();
    pages.at(-1)!.push({ row, x: MARGIN + col * (TEXT_COLUMN_W + TEXT_COLUMN_GAP), y });
    y += row.h;
  });
  return pages;
}

/**
 * The footer of a sheet or rules texts page: a line, who and which page,
 * and the date. A kept copy says which copy and the level of the original
 * it was made from ("as of level 4"). If the line would not fit at the
 * smallest size, the character's name is shortened (to 8 letters at least),
 * and only then the copy's.
 */
function pageFooter(pen: Pen, g: GridGeometry, model: SheetModel, page: number, total: number): void {
  const style = { ...S.footer, size: g.type.footer };
  const left = g.margin;
  const right = g.page.width - g.margin;
  const line = footerLine(g);
  pen.line(left, line, right, line, 0.3, "#999");
  const room = right - left - 40;
  const m = pen.messages;
  const words = (who: string, copyName: string) =>
    (model.origin.kind === "copy"
      ? [who, copyName, m.asOfLevel(model.origin.fromLevel), model.unitsLine, m.page(page, total)]
      : [who, model.levelLabel, model.unitsLine, m.page(page, total)]
    ).join(" · ");
  const fits = (text: string) => pen.width(text, { ...style, size: g.type.min }) <= room;
  const cut = (text: string, n: number) => (n >= text.length ? text : `${text.slice(0, n).trimEnd()}…`);
  // The copy's name (its date and time) tells copies apart: the character's name gives way first.
  const copyName = model.origin.kind === "copy" ? model.origin.name : "";
  let who = model.name.length;
  let which = copyName.length;
  let footer = words(model.name, copyName);
  while (!fits(footer) && (who > 8 || which > 1)) {
    if (who > 8) who--;
    else which--;
    footer = words(cut(model.name, who), cut(copyName, which));
  }
  pen.text(footer, left, g.page.height - g.margin, pen.fit(footer, style, room, g.type.min));
  pen.text(model.createdOn, right, g.page.height - g.margin, style, "right");
}

/** The head of every page after the first: the character's name and level over a line. */
function continuationHead(pen: Pen, g: GridGeometry, model: SheetModel): void {
  pen.text(`${model.name} · ${model.levelLabel}`, g.margin, g.margin + 4, S.fieldName);
  pen.line(g.margin, g.margin + 6, g.page.width - g.margin, g.margin + 6, 0.6);
}

// ------------------------------------------------------------------ document

export interface RenderedPdf {
  bytes: Uint8Array<ArrayBuffer>;
  pages: number;
  sheetPages: number;
  cardPages: number;
  textPages: number;
  /** Where each sheet section ended up, per sheet page, in mm. */
  sheetLayout: Placed[][];
  /** Every field drawn, in drawing order, with its page and box in mm. */
  fields: DrawnField[];
}

export interface RenderOptions {
  /**
   * The parts to print; they always follow each other as sheet, cards, rules
   * texts, whatever the order given. Without: the sheet and the cards.
   */
  parts?: readonly PrintPart[];
  /** The design of the sheet; without, the first one (`SHEET_DESIGNS`). */
  design?: string;
  /**
   * The play state to write into the fields (sheet and cards); without, the
   * fields are empty, to write on by hand.
   */
  play?: PlayState;
}

/** A sheet laid out by a design: what is where on each page, and how to draw page `n` (from 0). */
interface LaidSheet {
  pages: Placed[][];
  draw: (n: number) => void;
}

/** How a design lays out and draws the sheet; `bottomOf(n)` is the lowest anything on page `n` may reach. */
interface SheetPainter {
  geometry: GridGeometry;
  lay: (grid: Grid, model: SheetModel, bottomOf: (page: number) => number) => LaidSheet;
}

/** The painters of sheet designs by design id. Cards and rules texts look the same in every design. */
const PAINTERS: Readonly<Record<string, SheetPainter>> = {
  verbose: {
    geometry: VERBOSE_GEOMETRY,
    lay: (grid, model, bottomOf) => {
      const pages = placeSections(grid, withWriting(grid, model.sections), bottomOf);
      return { pages, draw: (n) => pages[n]!.forEach((p) => drawPlaced(grid, p)) };
    },
  },
  classic: {
    geometry: CLASSIC_GEOMETRY,
    lay: (grid, model, bottomOf) => layClassic(grid.pen, CLASSIC_GEOMETRY, model.sections, bottomOf),
  },
};

/** Every place drawn on the sheet and the cards where a player writes or ticks, in drawing order. */
export type { DrawnField };

/** The printout of a sheet model as one A4 PDF: the sheet, the cards and the rules texts, as asked. */
export async function renderPdf(model: SheetModel, options: RenderOptions = {}): Promise<RenderedPdf> {
  const m = MESSAGES[model.language];
  if (!m) throw new Error(`no page words in "${model.language}"`);
  const parts = new Set(inFileOrder(options.parts ?? DEFAULT_API_PARTS));
  if (parts.size === 0) throw new Error("nothing to print");
  const design = options.design ?? SHEET_DESIGNS[0]!.id;
  const painter = PAINTERS[design];
  if (!painter) throw new Error(`no painter for the design "${design}"`);
  const geometry = painter.geometry;
  // The PDF is dated like the sheet: the original when it was made, a copy when it was kept.
  const createdAt = new Date(
    model.origin.kind === "original" ? model.origin.builtAt : model.origin.createdAt,
  );
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
      CreationDate: createdAt,
      ModDate: createdAt,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const pen = new Pen(doc, model.language, m, fonts);
  pen.play = options.play ?? {};
  const grid: Grid = { pen, g: geometry, st: gridStyles(geometry) };
  const sheetBottom = contentBottom(geometry);

  const cards = parts.has("cards") ? model.cards : [];
  const texts = parts.has("texts");
  // The source and license line is wrapped, never cut; on the sheet and the
  // rules texts it needs room above the footer on the document's last page.
  const attributionLh = pen.lineHeight(S.footer, 1.2);
  const sheetAttribution = pen.wrap(model.attribution, S.footer, CONTENT_W).filter((l) => l !== "");
  const designAttribution = pen
    .wrap(model.attribution, grid.st.footer, contentWidth(geometry))
    .filter((l) => l !== "");
  const cardAttribution = pen.wrap(model.attribution, S.footer, PAGE_W - 2 * GRID_X).filter((l) => l !== "");
  const attributionRoom = sheetAttribution.length > 0 ? sheetAttribution.length * attributionLh + 2 : 0;
  const sheetIsLast = cards.length === 0 && !texts;
  const designAttributionRoom =
    designAttribution.length > 0 ? designAttribution.length * attributionLh + 2 : 0;
  const reserve = sheetIsLast ? designAttributionRoom : 0;
  // Only the last page gives up that room, and which page is last shows
  // after placing: the pages before it keep their full height (a page 1
  // that holds its boxes without cards must hold them with cards too).
  let sheet: LaidSheet = { pages: [], draw: () => {} };
  if (parts.has("sheet")) {
    const full = painter.lay(grid, model, () => sheetBottom);
    const lastFull = full.pages.length - 1;
    sheet =
      reserve === 0
        ? full
        : painter.lay(grid, model, (page) => sheetBottom - (page >= lastFull ? reserve : 0));
  }
  const sheetPages = sheet.pages;
  const faces = cards.flatMap((c) => cardFaces(pen, c, m));
  const cardPages = Math.ceil(faces.length / CARDS_PER_PAGE);
  // Rules texts come last: every one of their pages keeps the source line's room, few lines.
  const textFlow = texts ? flowRows(rulesRows(pen, model.rulesTexts), CONTENT_BOTTOM - attributionRoom) : [];
  const total = sheetPages.length + cardPages + textFlow.length;
  const isLast = (page: number) => page === total;

  sheetPages.forEach((_, i) => {
    const page = i + 1;
    pen.page = page;
    doc.addPage({ size: "A4", margin: 0 });
    if (i > 0) continuationHead(pen, geometry, model);
    sheet.draw(i);
    if (isLast(page))
      pen.lines(
        designAttribution,
        geometry.margin,
        footerLine(geometry) - 1.5 - designAttribution.length * attributionLh,
        grid.st.footer,
        1.2,
      );
    pageFooter(pen, geometry, model, page, total);
  });

  for (let p = 0; p < cardPages; p++) {
    const page = sheetPages.length + p + 1;
    pen.page = page;
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

  textFlow.forEach((placed, i) => {
    const page = sheetPages.length + cardPages + i + 1;
    doc.addPage({ size: "A4", margin: 0 });
    if (i === 0) {
      pen.text(m.rulesTextsTitle, MARGIN, MARGIN + 6, pen.fit(m.rulesTextsTitle, T.title, CONTENT_W, 10));
      const who = `${model.name} · ${model.levelLabel}`;
      pen.text(who, MARGIN, MARGIN + 11, pen.fit(who, S.meta, CONTENT_W));
      pen.line(MARGIN, MARGIN + 13, MARGIN + CONTENT_W, MARGIN + 13, 0.6);
      if (model.rulesTexts.length === 0)
        pen.paragraph(m.noRulesTexts, MARGIN, TEXTS_FIRST_TOP, CONTENT_W, T.rules);
    } else continuationHead(pen, PAGE, model);
    for (const p of placed) p.row.draw?.(pen, p.x, p.y);
    if (isLast(page))
      pen.lines(
        sheetAttribution,
        MARGIN,
        FOOTER_LINE_Y - 1.5 - sheetAttribution.length * attributionLh,
        S.footer,
        1.2,
      );
    pageFooter(pen, PAGE, model, page, total);
  });

  doc.end();
  await done;
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    pages: total,
    sheetPages: sheetPages.length,
    cardPages,
    textPages: textFlow.length,
    sheetLayout: sheetPages,
    fields: pen.fields,
  };
}
