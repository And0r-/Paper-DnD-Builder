/**
 * The sheet in the "classic" design (`@builder/sheet/designs/classic`): the
 * layout of the well-known three-column sheet, boxes with lines and circles
 * to fill in, titles and short lines only. Where a section goes comes from
 * the design's plan (kind and order of the sections); every measure from its
 * geometry, which the screen reads too. Only the layout is borrowed: the
 * frames and type are ours, every word is the package's or the builder's.
 *
 * Page 1 has three columns: the scores (A), their further numbers and the
 * check lists (B), the boxes for the table and the tables (C); lists run in
 * a band under A and B. What does not fit goes on in two columns from page
 * 2, then answers and notes. Sections marked apart get a page of their own
 * if one of them is a box row.
 *
 * With a play state on the pen, what was written and ticked at the table
 * is drawn into the fields, as in every design.
 */
import {
  classicPlan,
  clusterRows,
  firstColumns,
  type ClassicGeometry,
  type ClassicPlan,
} from "@builder/sheet/designs/classic";
import { contentWidth } from "@builder/sheet/designs";
import type { FeatureRow, Messages, SheetSection, StatBox } from "@builder/sheet";
import { drawUses, INK, MM_PER_PT, usesWidth, type Pen, type TextStyle } from "./pen.ts";
import type { Placed } from "./verbose.ts";

const LINE = "#222";
const RULE = "#9A9A9A";

type Section<K extends SheetSection["kind"]> = Extract<SheetSection, { kind: K }>;

function classicStyles(g: ClassicGeometry) {
  const t = g.type;
  const more = g.more;
  return {
    name: { font: "bold", size: t.name },
    summary: { size: t.summary },
    label: { size: more.label, caps: true, color: "#444", spacing: 0.05 },
    title: { font: "bold", size: t.sectionTitle, caps: true, spacing: 0.08 },
    big: { font: "bold", size: t.bigValue },
    mid: { font: "bold", size: more.mid },
    value: { font: "semibold", size: more.value },
    body: { size: t.body },
    small: { size: t.min, color: "#333" },
    rowName: { font: "semibold", size: more.rowName },
    group: { font: "bold", size: t.min, caps: true, spacing: 0.08, color: "#333" },
    mark: { font: "bold", size: t.min, color: "#333" },
    written: { font: "semibold", size: t.body, color: INK },
    pencil: { font: "bold", size: 14, color: INK },
  } satisfies Record<string, TextStyle>;
}

interface Ctx {
  pen: Pen;
  g: ClassicGeometry;
  st: ReturnType<typeof classicStyles>;
  m: Messages;
}

// ------------------------------------------------------------------ blocks

/** Something placed in a column: measured for a width, drawn at a top. */
interface Block {
  /** The section it shows; none for lines that only fill a column. */
  section: SheetSection | null;
  h: (w: number) => number;
  draw: (x: number, y: number, w: number) => void;
  /** A section's title: kept with the block after it, repeated where the section goes on in the next column. */
  title?: string;
  /** Kept with the block after it (a group's heading). */
  keep?: boolean;
  /** Notes: the lines grow to the bottom of the column if they come last. */
  fill?: (lines: number) => Block;
  /** Notes: fewer lines, taken when they come last and would otherwise start a column of their own. */
  shrink?: Block;
}

function measured(
  c: Ctx,
  section: SheetSection | null,
  f: (x: number, y: number, w: number) => number,
  more: Partial<Block> = {},
): Block {
  return {
    section,
    h: (w) => {
      const dry = c.pen.dry;
      c.pen.dry = true;
      const h = f(0, 0, w);
      c.pen.dry = dry;
      return h;
    },
    draw: (x, y, w) => void f(x, y, w),
    ...more,
  };
}

function titleBlock(c: Ctx, section: SheetSection, title: string): Block {
  const { pen, g, st } = c;
  return measured(
    c,
    section,
    (x, y, w) => {
      pen.text(title, x, y + 3, pen.fit(title, st.title, w));
      pen.line(x, y + 4.2, x + w, y + 4.2, 0.8, LINE);
      return g.titleHeight;
    },
    { title },
  );
}

/** A section's title block, or nothing for a section without a title. */
function titled(c: Ctx, s: SheetSection, title = s.kind === "header" ? "" : s.title): Block[] {
  return title === "" ? [] : [titleBlock(c, s, title)];
}

/** Lines to write on, filling a column; they belong to no section's fields. */
function linesBlock(c: Ctx, n: number, section: SheetSection | null = null): Block {
  const { pen, g } = c;
  return measured(c, section, (x, y, w) => {
    for (let i = 1; i <= n; i++) pen.line(x, y + i * g.writingLine, x + w, y + i * g.writingLine, 0.4, RULE);
    return n * g.writingLine;
  });
}

/** A box heading at 7 pt, in two lines if one is not enough, in capitals like the others; returns its lines and style. */
function smallLabel(c: Ctx, text: string, w: number) {
  return c.pen.label(text, c.st.label, w, 7, true);
}

function smallBoxHeight(c: Ctx, b: StatBox, w: number, min: number): number {
  const { g } = c;
  const label = smallLabel(c, b.label, w - 2).lines.length;
  if (b.style !== "boxes" || b.squares === 0) return Math.max(min, 11 + label * 2.9);
  const per = Math.max(1, Math.floor((w - 3) / (g.box.square + 1)));
  const rows = Math.ceil(b.squares / per);
  return Math.max(min, 6 + (b.text !== "" ? 4.5 : 0) + rows * (g.box.square + 1) + label * 2.9);
}

/** A compact box: label at the bottom, the number or the marks to tick in the middle. */
function smallBox(c: Ctx, b: StatBox, x: number, y: number, w: number, h: number): void {
  const { pen, g, st } = c;
  pen.rect(x, y, w, h, { width: 0.6, stroke: LINE, radius: 1.2 });
  const label = smallLabel(c, b.label, w - 2);
  const labelTop = y + h - 1.6 - (label.lines.length - 1) * 2.9;
  label.lines.forEach((l, i) => pen.text(l, x + w / 2, labelTop + i * 2.9, label.style, "center"));
  const room = labelTop - 2.4 - y;
  if (b.style === "circles") {
    const n = b.circles;
    const step = Math.min(4.2, (w - 4) / Math.max(1, n));
    const r = Math.min(g.box.circle / 2, step * 0.38);
    const cy = y + room / 2 + 0.6;
    const left = x + w / 2 - ((n - 1) * step) / 2;
    const ticked = pen.checks(b.field, n);
    if (n > 0) pen.field(b.field, left - r, cy - r, (n - 1) * step + 2 * r, 2 * r, { ticks: ticked });
    for (let i = 0; i < n; i++) {
      pen.circle(left + i * step, cy, r, { width: 0.6 });
      if (i < ticked) pen.tick(left + i * step, cy, 2 * r);
    }
  } else if (b.style === "boxes") {
    const s = g.box.square;
    const per = Math.max(1, Math.floor((w - 3) / (s + 1)));
    const rows = Math.ceil(b.squares / per);
    if (b.text !== "") pen.text(b.text, x + w / 2, y + 4.2, pen.fit(b.text, st.value, w - 2), "center");
    const head = b.text !== "" ? 4.5 : 0;
    const top = y + head + (room - head - rows * (s + 1)) / 2 + 1;
    const ticked = pen.checks(b.field, b.squares);
    const widest = Math.min(per, b.squares) * (s + 1) - 1;
    if (b.squares > 0)
      pen.field(b.field, x + w / 2 - widest / 2, top, widest, rows * (s + 1) - 1, { ticks: ticked });
    for (let i = 0; i < b.squares; i++) {
      const row = Math.floor(i / per);
      const inRow = Math.min(per, b.squares - row * per);
      const left = x + w / 2 - (inRow * (s + 1) - 1) / 2;
      const sx = left + (i % per) * (s + 1);
      const sy = top + row * (s + 1);
      pen.rect(sx, sy, s, s, { width: 0.5, stroke: LINE });
      if (i < ticked) pen.tick(sx + s / 2, sy + s / 2, s);
    }
  } else if (b.style === "pencil") {
    pen.text(pen.messages.pencil, x + 1.5, y + 3.4, pen.fit(pen.messages.pencil, st.small, w - 3));
    const now = pen.written(b.field);
    pen.field(b.field, x + 1, y + 4.4, w - 2, Math.max(1, room - 4), { text: now });
    if (now !== "") pen.text(now, x + w / 2, y + room - 0.5, pen.fit(now, st.pencil, w - 2), "center");
  } else {
    pen.text(b.text, x + w / 2, y + room / 2 + 2.2, pen.fit(b.text, st.mid, w - 2), "center");
  }
}

/** The head of page 1: the name on a line, the summary, a box with the answers and who plays. */
function headerBlock(c: Ctx, s: Section<"header">): Block {
  const { pen, g, st, m } = c;
  return measured(c, s, (x, y, w) => {
    pen.text(s.packageName, x + w, y + 3, pen.fit(s.packageName, st.small, w / 3), "right");
    const nw = g.first.nameWidth;
    // A long name is set smaller, down to 9 pt, then in two lines; it never reaches the box beside it.
    const name = pen.fit(s.name, st.name, nw - 1, 9);
    if (pen.width(s.name, name) <= nw - 1) pen.text(s.name, x + 0.5, y + 11, name);
    else {
      const two = pen.wrapWords(s.name, { ...st.name, size: 9 }, nw - 1);
      pen.lines(two.lines.slice(0, 2), x + 0.5, y + 4.2, two.style, 1.1);
    }
    pen.line(x, y + 13, x + nw, y + 13, 0.6, LINE);
    pen.text(s.summary, x + 0.5, y + 18, pen.fit(s.summary, st.summary, nw));
    const bx = x + nw + 4;
    const bw = w - nw - 4;
    pen.rect(bx, y + 5, bw, 20, { width: 0.6, stroke: LINE, radius: g.box.radius });
    const cells = [
      ...s.fields.map((f) => ({ label: f.label, text: f.text, field: undefined as string | undefined })),
      { label: m.playedBy, text: "", field: s.playedByField },
    ];
    const per = Math.ceil(cells.length / 2);
    const fw = (bw - 4 - (per - 1) * 3) / per;
    cells.forEach((f, i) => {
      const fx = bx + 2 + (i % per) * (fw + 3);
      const base = y + 12 + Math.floor(i / per) * 9;
      if (f.field !== undefined) {
        const now = pen.written(f.field);
        pen.field(f.field, fx, base - 4, fw, 4.6, { text: now });
        pen.text(now, fx + 0.5, base - 0.8, pen.fit(now, st.written, fw - 1));
      } else pen.text(f.text, fx + 0.5, base - 0.8, pen.fit(f.text, st.value, fw - 1));
      pen.line(fx, base, fx + fw, base, 0.4, RULE);
      pen.text(f.label, fx, base + 2.8, pen.fit(f.label, st.label, fw));
    });
    return g.first.head;
  });
}

/** Column A: a tall box per score, the number made from it big in the middle, the score in an oval below. */
function scoresBlock(c: Ctx, s: Section<"scoreColumn">): Block {
  const { pen, g, st } = c;
  const n = s.scores.length;
  const gap = g.box.scoreGap;
  const bh = Math.max(18, Math.min(g.box.score, (g.first.scoresHeight - (n - 1) * gap) / Math.max(1, n)));
  return measured(c, s, (x, y, w) => {
    s.scores.forEach((sc, i) => {
      const top = y + i * (bh + gap);
      pen.rect(x, top, w, bh, { width: 0.6, stroke: LINE, radius: 2 });
      const label = pen.label(sc.label, st.title, w - 2);
      label.lines.forEach((l, j) => pen.text(l, x + w / 2, top + 4 + j * 2.9, label.style, "center"));
      const big = sc.derived ?? sc.value;
      pen.text(big, x + w / 2, top + bh / 2 + 3, pen.fit(big, st.big, w - 4, 12), "center");
      if (sc.derived !== null) {
        const { width: ow, height: oh } = g.box.oval;
        const cy = top + bh - 4.5;
        pen.rect(x + w / 2 - ow / 2, cy - oh / 2, ow, oh, { width: 0.6, stroke: LINE, radius: oh / 2 });
        pen.text(sc.value, x + w / 2, cy + 1.3, pen.fit(sc.value, st.value, ow - 2), "center");
      }
    });
    return n * (bh + gap) - gap;
  });
}

/**
 * Top of column B: the further number of every score that has one, as a list. No circle: the
 * package does not say which of them are trained, and an empty circle would say "not trained".
 */
function extrasBlock(c: Ctx, s: Section<"scoreColumn">): Block | null {
  const { pen, g, st } = c;
  const extras = s.scores.filter((sc) => sc.extra);
  if (extras.length === 0) return null;
  const title = extras[0]!.extra!.label;
  const row = g.box.row;
  return measured(c, s, (x, y, w) => {
    const h = 5 + extras.length * row + 2;
    pen.rect(x, y, w, h, { width: 0.6, stroke: LINE, radius: g.box.radius });
    pen.text(title, x + w / 2, y + 4, pen.fit(title, st.title, w - 4), "center");
    extras.forEach((sc, i) => {
      const base = y + 9 + i * row;
      pen.text(sc.extra!.value, x + 9, base, pen.fit(sc.extra!.value, st.value, 6), "right");
      pen.line(x + 3, base + 0.6, x + 9.5, base + 0.6, 0.4, LINE);
      pen.text(sc.label, x + 11, base, pen.fit(sc.label, st.body, w - 13));
    });
    return h;
  });
}

/** One row of a check list: a circle (filled: marked), the number on a line, the name, the note small at the end. */
function checkRow(
  c: Ctx,
  item: Section<"checkList">["items"][number],
  x: number,
  y: number,
  w: number,
): void {
  const { pen, g, st } = c;
  const base = y + 4;
  const r = g.box.dot / 2;
  if (item.strong) {
    pen.circle(x + 3.5, base - 1.1, r * 0.55, { fill: true });
    pen.circle(x + 3.5, base - 1.1, r * 1.1, { width: 0.5 });
  } else pen.circle(x + 3.5, base - 1.1, r, { fill: item.marked });
  const byHand = item.total.text === "" ? pen.written(item.field) : "";
  pen.field(item.field, x + 6, base - 3.6, 6.5, 4.6, { text: byHand });
  const total = item.total.text === "" ? byHand : item.total.text;
  pen.text(total, x + 12, base, pen.fit(total, item.total.text === "" ? st.written : st.value, 6), "right");
  pen.line(x + 6, base + 0.6, x + 12.5, base + 0.6, 0.4, LINE);
  const noteW = item.note === "" ? 0 : Math.min(15, pen.width(item.note, st.small) + 1);
  pen.text(item.name, x + 14, base, pen.fit(item.name, st.body, w - 16 - noteW));
  if (item.note !== "") pen.text(item.note, x + w - 2, base, pen.fit(item.note, st.small, noteW), "right");
}

function legendHeight(c: Ctx, legend: string[], w: number): number {
  return legend.reduce(
    (h, l) => h + c.pen.wrap(l, c.st.small, w).length * c.pen.lineHeight(c.st.small, 1.2),
    0,
  );
}

function drawLegend(c: Ctx, legend: string[], x: number, y: number, w: number): number {
  return legend.reduce((top, l) => c.pen.paragraph(l, x, top, w, c.st.small, 1.2), y);
}

/** A check list in one frame, its title at the bottom; null if it is taller than `room`. */
function framedChecks(c: Ctx, s: Section<"checkList">, w: number, room: number): Block | null {
  const { pen, g, st } = c;
  const row = g.box.row;
  const height = (bw: number) => 3 + s.items.length * row + legendHeight(c, s.legend, bw - 4) + 6;
  if (height(w) > room) return null;
  return measured(c, s, (x, y, bw) => {
    const h = height(bw);
    pen.rect(x, y, bw, h, { width: 0.6, stroke: LINE, radius: g.box.radius });
    s.items.forEach((item, i) => checkRow(c, item, x, y + 1.5 + i * row, bw));
    drawLegend(c, s.legend, x + 2, y + 2 + s.items.length * row, bw - 4);
    pen.text(s.title, x + bw / 2, y + h - 1.8, pen.fit(s.title, st.title, bw - 4), "center");
    return h;
  });
}

/** A check list as rows that can go on in the next column. */
function checkBlocks(c: Ctx, s: Section<"checkList">): Block[] {
  return [
    ...titled(c, s),
    ...s.items.map((item) =>
      measured(c, s, (x, y, w) => {
        checkRow(c, item, x, y, w);
        return c.g.box.row;
      }),
    ),
    ...(s.legend.length > 0
      ? [measured(c, s, (x, y, w) => drawLegend(c, s.legend, x, y + 0.5, w) - y + 0.5)]
      : []),
  ];
}

/** A box after the score column in column B: the number in a small box, the name on a tab beside it. */
function sideBlocks(c: Ctx, s: Section<"statBoxes">): Block[] {
  const { pen, g, st } = c;
  if (s.boxes.some((b) => b.style !== "number")) return boxRowBlocks(c, s);
  const { width: bw, height: bh } = g.box.side;
  return s.boxes.map((b) =>
    measured(c, s, (x, y, w) => {
      pen.rect(x, y, bw, bh, { width: 0.6, stroke: LINE, radius: 1.2 });
      pen.text(b.text, x + bw / 2, y + 6.2, pen.fit(b.text, st.mid, bw - 2), "center");
      pen.rect(x + bw, y + 1.5, w - bw, bh - 3, { width: 0.6, stroke: LINE, radius: 1 });
      pen.text(b.label, x + bw + 2, y + 5.4, pen.fit(b.label, st.title, w - bw - 4));
      return bh;
    }),
  );
}

/**
 * Boxes in rows as wide as a column allows (slots per rank), under the
 * section's title; a row shares the whole width, as in the sketch, a box at
 * most twice its usual width.
 */
function boxRowBlocks(c: Ctx, s: Section<"statBoxes">): Block[] {
  const { g } = c;
  const gap = g.box.gap;
  const rows = (w: number) => {
    const fit = Math.max(1, Math.floor((w + gap) / (g.box.rowBox.width * 0.6 + gap)));
    const per = Math.max(1, Math.min(fit, s.boxes.length));
    const out: StatBox[][] = [];
    for (let i = 0; i < s.boxes.length; i += per) out.push(s.boxes.slice(i, i + per));
    return { per, out };
  };
  return [
    ...titled(c, s),
    // One block per row of boxes, so a long row of them can go on in the next column.
    measured(c, s, (x, y, w) => {
      const { per, out } = rows(w);
      const bw = Math.min(2 * g.box.rowBox.width, (w - (per - 1) * gap) / per);
      let top = y + 0.5;
      for (const row of out) {
        const h = Math.max(...row.map((b) => smallBoxHeight(c, b, bw, g.box.rowBox.height)));
        row.forEach((b, i) => smallBox(c, b, x + i * (bw + gap), top, bw, h));
        top += h + gap;
      }
      return top - y - gap + 1;
    }),
  ];
}

/** Top of column C: the boxes at the table, numbers in a row, a wide box per pencil value, then all to tick. */
function clusterBlock(c: Ctx, sections: Section<"statBoxes">[]): Block | null {
  const { pen, g, st } = c;
  const boxes = sections.flatMap((s) => s.boxes);
  if (boxes.length === 0) return null;
  const gap = g.box.gap;
  return measured(c, sections[0]!, (x, y, w) => {
    let top = y;
    for (const row of clusterRows(boxes)) {
      if (row.style === "pencil") {
        const b = row.boxes[0]!;
        const h = g.box.pencil;
        pen.rect(x, top, w, h, { width: 0.6, stroke: LINE, radius: g.box.radius });
        // The value to start with, then room to write the current one.
        if (b.hint !== "") {
          pen.text(b.hint, x + 2, top + 3.6, pen.fit(b.hint, st.small, w / 2));
          const after = x + 2 + pen.width(b.hint, pen.fit(b.hint, st.small, w / 2)) + 1;
          pen.line(after, top + 4.2, Math.max(after + 10, x + w / 2), top + 4.2, 0.4, RULE);
        }
        pen.text(pen.messages.pencil, x + 2, top + 9, pen.fit(pen.messages.pencil, st.small, w - 4));
        const now = pen.written(b.field);
        pen.field(b.field, x + 2, top + 10, w - 4, h - 15, { text: now });
        if (now !== "") pen.text(now, x + w / 2, top + h - 7, pen.fit(now, st.pencil, w - 4), "center");
        pen.text(b.label, x + w / 2, top + h - 1.8, pen.fit(b.label, st.title, w - 4), "center");
        top += h + gap;
        continue;
      }
      const n = row.boxes.length;
      const bw = (w - (n - 1) * gap) / n;
      const min = row.style === "numbers" ? g.box.number : g.box.marks;
      const h = Math.max(...row.boxes.map((b) => smallBoxHeight(c, b, bw, min)));
      row.boxes.forEach((b, i) => smallBox(c, b, x + i * (bw + gap), top, bw, h));
      top += h + gap;
    }
    return top - gap - y;
  });
}

/** A table: a row per thing in boxes, two empty rows to write more by hand. */
function statTableBlocks(c: Ctx, s: Section<"statTable">): Block[] {
  const { pen, g, st } = c;
  const wraps = (i: number) => s.wrap?.[i] === true;
  const small = { ...st.value, size: g.type.min };
  const names = Math.max(18, ...s.rows.map((r) => pen.width(r.name, st.rowName))) + 4;
  // A heading may take two lines, small and not in capitals: it needs its longest word so.
  const plain = { ...st.label, caps: false, spacing: 0 };
  const headW = (col: string) => Math.max(0, ...col.split(/\s+/u).map((word) => pen.width(word, plain)));
  // A narrow column is as wide as its widest cell or heading; when they do not all fit, each gives
  // way evenly down to its widest cell at the smallest size. Wrapping columns share the rest.
  const natural = s.columns.map(
    (col, i) =>
      Math.max(pen.width(col, st.label), ...s.rows.map((r) => pen.width(r.cells[i] ?? "", st.value)), 8) + 3,
  );
  // A long cell (a row written by hand) wraps rather than take the room of the others.
  const least = s.columns.map(
    (col, i) =>
      Math.min(32, Math.max(headW(col), ...s.rows.map((r) => pen.width(r.cells[i] ?? "", small)), 5)) + 2.5,
  );
  // A wrapping column is never narrower than its longest word.
  const words = (t: string, style: TextStyle) =>
    Math.max(0, ...t.split(/\s+/u).map((word) => pen.width(word, style)));
  const wrapMin = s.columns.map((col, i) =>
    wraps(i) ? Math.max(15, headW(col), ...s.rows.map((r) => words(r.cells[i] ?? "", st.small))) + 3 : 0,
  );
  const sum = (a: number[]) => a.reduce((t, n, j) => t + (wraps(j) ? 0 : n), 0);
  const wrapRoom = wrapMin.reduce((a, b) => a + b, 0);
  // The name column gives way first, so the numbers keep one line; never below its longest
  // word in small type, so a long name of one row does not break the others' in mid-word.
  const nameLeast = Math.max(
    16,
    ...s.rows.flatMap((r) => r.name.split(/\s+/u)).map((w) => pen.width(w, st.small) + 4),
  );
  const nameW = (w: number) => {
    const wide = Math.min(w * 0.28, names);
    const short = w - wide - wrapRoom - sum(least);
    return short >= 0 ? wide : Math.max(Math.min(nameLeast, wide), wide + short);
  };
  const widths = (w: number): number[] => {
    const rest = w - nameW(w);
    const room = rest - wrapRoom;
    const [nat, low] = [sum(natural), sum(least)];
    const fixed = s.columns.map((_, i) =>
      nat <= room
        ? natural[i]!
        : low <= room
          ? least[i]! + ((natural[i]! - least[i]!) * (room - low)) / Math.max(1, nat - low)
          : (least[i]! * room) / Math.max(1, low),
    );
    // What is left goes to the wrapping columns, by their least.
    const left = rest - sum(fixed);
    return fixed.map((f, i) => (wraps(i) ? (left * wrapMin[i]!) / Math.max(1, wrapRoom) : f));
  };
  /** A cell's lines: one line at the largest size that fits, else wrapped small. */
  const cellLines = (text: string, cw: number, wrap: boolean) => {
    // A millimetre of room to the cell's edges on either side.
    const one = pen.fit(text, st.value, cw - 2);
    if (!wrap && pen.width(text, one) <= cw - 2) return { lines: [text], style: one, wrapped: false };
    return { lines: pen.wrap(text, st.small, cw - 2), style: st.small, wrapped: true };
  };
  const lefts = (x: number, w: number) => {
    const out: number[] = [];
    let at = x + nameW(w);
    for (const cw of widths(w)) {
      out.push(at);
      at += cw;
    }
    return out;
  };
  const head = measured(
    c,
    s,
    (x, y, w) => {
      // A heading wider than its column at 7 pt takes two lines; if one has to lose its
      // capitals for that, all headings of the table go without, so they read as one row.
      let lines = 1;
      const ws = widths(w);
      let labels = s.columns.map((col, i) => pen.label(col, st.label, ws[i]! - 1.5));
      if (labels.some((l) => !l.style.caps))
        labels = s.columns.map((col, i) => pen.label(col, plain, ws[i]! - 1.5));
      lefts(x, w).forEach((cx, i) => {
        const label = labels[i]!;
        lines = Math.max(lines, label.lines.length);
        label.lines.forEach((l, k) => pen.text(l, cx + 0.5, y + 2.6 + k * 2.8, label.style));
      });
      return 3.6 + (lines - 1) * 2.8;
    },
    { keep: true },
  );
  const lead = pen.lineHeight(st.small, 1.1);
  const row = (name: string, cells: string[]) =>
    measured(c, s, (x, y, w) => {
      const ws = widths(w);
      const nw = nameW(w) - 3;
      // Too long for a line: wrapped between words, never inside one.
      const wrapped =
        pen.width(name, pen.fit(name, st.rowName, nw)) <= nw ? null : pen.wrapWords(name, st.small, nw);
      const nameLines = wrapped?.lines ?? null;
      const shown = s.columns.map((_, i) => cellLines(cells[i] ?? "", ws[i]! - 1.5, wraps(i)));
      // A wrapped cell or name makes the whole row taller.
      const rh = Math.max(
        g.box.tableRow,
        (nameLines?.length ?? 0) * lead + 1.4,
        ...shown.map((sh) => (sh.wrapped ? sh.lines.length * lead + 1.4 : 0)),
      );
      pen.rect(x, y + 0.4, nameW(w) - 1, rh, { width: 0.4, stroke: RULE });
      if (wrapped) pen.lines(wrapped.lines, x + 1, y + 1.1, wrapped.style, 1.1);
      else pen.text(name, x + 1, y + 3.8, pen.fit(name, st.rowName, nw));
      lefts(x, w).forEach((cx, i) => {
        const cw = ws[i]! - 1.5;
        pen.rect(cx, y + 0.4, cw, rh, { width: 0.4, stroke: RULE });
        const sh = shown[i]!;
        if (sh.wrapped) pen.lines(sh.lines, cx + 1, y + 1.1, sh.style, 1.1);
        else pen.text(sh.lines[0]!, cx + cw / 2, y + 3.8, sh.style, "center");
      });
      return rh + 1.4;
    });
  return [...titled(c, s), head, ...s.rows.map((r) => row(r.name, r.cells)), row("", []), row("", [])];
}

function featureRow(c: Ctx, r: FeatureRow, x: number, y: number, w: number): number {
  const { pen, st } = c;
  const nameW = Math.min(36, w * 0.36);
  const uw = usesWidth(pen, r.uses, st.small);
  const marksW = r.marks !== "" ? pen.width(r.marks, st.mark) + 1.5 : 0;
  const textX = x + nameW + 1.5 + marksW;
  const textW = w - nameW - 1.5 - marksW - (uw > 0 ? uw + 2 : 0);
  const name = pen.wrapWords(r.name, st.rowName, nameW);
  let ny = pen.lines(name.lines, x, y + 0.6, name.style, 1.1);
  if (r.note) ny = pen.paragraph(r.note, x, ny, nameW, st.small, 1.1);
  if (r.marks !== "") pen.text(r.marks, x + nameW + 1.5, y + 3.2, st.mark);
  const ty = r.text !== "" ? pen.paragraph(r.text, textX, y + 0.6, textW, st.body, 1.15) : y;
  drawUses(pen, r.uses, x + w, y + 0.6 + st.small.size * 0.8 * MM_PER_PT, st.small, r.usesField);
  const bottom = Math.max(ny, ty, y + 4) + 0.8;
  pen.line(x, bottom, x + w, bottom, 0.3, RULE);
  return bottom - y;
}

/** Features: the title, the lead, a heading per group, a row per thing (name, short line, use boxes), the legend. */
function featureBlocks(c: Ctx, s: Section<"featureTable">): Block[] {
  const { pen, st } = c;
  const out: Block[] = [...titled(c, s)];
  for (const lead of s.lead)
    out.push(measured(c, s, (x, y, w) => pen.paragraph(lead, x, y + 0.5, w, st.small) + 1 - y));
  let group: string | null = null;
  for (const r of s.rows) {
    if (r.group !== null && r.group.key !== group) {
      const g = r.group;
      out.push(
        measured(c, s, (x, y, w) => (pen.text(g.title, x, y + 3.2, pen.fit(g.title, st.group, w)), 4.4), {
          keep: true,
        }),
      );
    } else if (r.group === null && group !== null) {
      // The player's own rows after the package's groups: a gap, under no group's heading.
      out.push(measured(c, s, () => 2.4, { keep: true }));
    }
    group = r.group?.key ?? null;
    out.push(measured(c, s, (x, y, w) => featureRow(c, r, x, y, w)));
  }
  if (s.legend.length > 0)
    out.push(measured(c, s, (x, y, w) => drawLegend(c, s.legend, x, y + 1, w) + 0.5 - y));
  return out;
}

/**
 * A list on lines, an entry a line, wrapped onto the next line where it is
 * longer; with `room` (mm), empty lines fill it, and only so many: empty
 * lines never go on in another column. What the play state wrote goes on
 * the empty lines, in order.
 */
function listBlocks(c: Ctx, s: Section<"list">, room = 0): Block[] {
  const { pen, g, st } = c;
  const line = g.box.listLine;
  // Written lines are wrapped to the width of the band (columns later are narrower, and wrap again).
  const bandW = firstColumns(g).a.w + g.first.gap + firstColumns(g).b.w;
  const written = pen.wrap(pen.written(s.field), st.written, bandW - 1).filter((l) => l.trim() !== "");
  const entryLines = (t: string, w: number) => pen.wrap(t, st.body, w - 1);
  /** The line under an entry (format 0.22), in the smallest type, and how far it pushes the rule down. */
  const detailOf = (i: number) => s.details?.[i] ?? "";
  const detailHeight = (d: string, w: number) =>
    d === "" ? 0 : pen.wrap(d, st.small, w - 1).length * pen.lineHeight(st.small, 1.15) + 0.9 + 1;
  const used = s.items.reduce(
    (n, t, i) => n + entryLines(t, bandW).length + Math.ceil(detailHeight(detailOf(i), bandW) / line),
    0,
  );
  // The flow leaves 0.6 mm after every block: the title, each entry, the empty lines.
  const fit = Math.max(0, Math.floor((room - g.titleHeight - 0.6 * (s.items.length + 2) - 1) / line));
  const blank = Math.max(written.length, room > 0 ? fit - used : s.blankLines);
  const entries = s.items.map((t, at) =>
    measured(c, s, (x, y, w) => {
      const lines = entryLines(t, w);
      const detail = detailOf(at);
      lines.forEach((l, i) => {
        const base = y + (i + 1) * line - 1;
        pen.text(l, x + 0.5, base - 0.8, st.body);
        // With a line under it, the entry's rule goes under that line.
        if (detail === "" || i < lines.length - 1) pen.line(x, base, x + w, base, 0.4, RULE);
      });
      if (detail === "") return lines.length * line;
      // Where the rule would be, the line starts; the rule goes under it.
      const top = y + lines.length * line - 1;
      const base = pen.paragraph(detail, x + 0.5, top + 0.1, w - 1, st.small, 1.15) + 0.8;
      pen.line(x, base, x + w, base, 0.4, RULE);
      return base + 1 - y;
    }),
  );
  const blanks =
    blank <= 0
      ? []
      : [
          measured(c, s, (x, y, w) => {
            const text = written.join("\n");
            const shown = pen.wrap(text, st.written, w - 1).filter((l) => l.trim() !== "");
            const n = Math.max(blank, shown.length);
            if (s.blankLines + written.length > 0) pen.field(s.field, x, y, w, n * line, { text });
            for (let i = 0; i < n; i++) {
              const base = y + (i + 1) * line - 1;
              const l = shown[i];
              if (l) pen.text(l, x + 0.5, base - 0.8, pen.fit(l, st.written, w - 1));
              pen.line(x, base, x + w, base, 0.4, RULE);
            }
            return n * line;
          }),
        ];
  return [...titled(c, s), ...entries, ...blanks];
}

/** Answers on a line each, the question small under it; an open one gets two lines to write on. */
function answerBlocks(c: Ctx, s: Section<"answers">): Block[] {
  const { pen, st } = c;
  return [
    ...titled(c, s),
    ...s.rows.map((r) =>
      measured(c, s, (x, y, w) => {
        const lines = r.text !== "" ? pen.wrap(r.text, st.value, w - 1) : ["", ""];
        lines.forEach((l, i) => {
          const base = y + 4.4 + i * 5;
          pen.text(l, x + 0.5, base - 0.8, st.value);
          pen.line(x, base, x + w, base, 0.4, RULE);
        });
        const after = y + 4.4 + (lines.length - 1) * 5;
        pen.text(r.label, x, after + 3, pen.fit(r.label, st.label, w));
        return after + 4.4 - y;
      }),
    ),
  ];
}

/** A rest of the apart part up to this high (mm) stays in one column: a short list is not split. */
const SHORT_REST = 90;

/** Lines notes keep at least when they come last and shrink to the room left. */
const LEAST_NOTE_LINES = 2;

/**
 * Notes: lines to write on, as many as the play state's text needs; the last
 * section's grow to the column's end, or shrink to the room left rather than
 * start a column (often a page) of their own.
 */
function notesBlocks(c: Ctx, s: Section<"notes">): Block[] {
  const { pen, g, st } = c;
  const lines = (n: number): Block =>
    measured(
      c,
      s,
      (x, y, w) => {
        const text = pen.written(s.field);
        const written = pen.wrap(text, st.written, w - 2).filter((l) => l.trim() !== "");
        const count = Math.max(n, text === "" ? 0 : written.length);
        if (count > 0) pen.field(s.field, x, y, w, count * g.writingLine, { text });
        for (let i = 0; i < count; i++) {
          const l = written[i];
          if (l) pen.text(l, x + 1, y + g.writingLine * i + 4.3, pen.fit(l, st.written, w - 2));
          pen.line(x, y + (i + 1) * g.writingLine, x + w, y + (i + 1) * g.writingLine, 0.4, RULE);
        }
        return count * g.writingLine + 1;
      },
      { fill: (more) => lines(Math.max(n, more)) },
    );
  const block = lines(s.lines);
  if (s.lines > LEAST_NOTE_LINES) block.shrink = lines(LEAST_NOTE_LINES);
  return [...titled(c, s), block];
}

/** Sections that have no place of their own in this design but may still come in a column. */
function otherBlocks(c: Ctx, s: SheetSection): Block[] {
  const { pen, st, g } = c;
  switch (s.kind) {
    case "header":
      return [
        measured(c, s, (x, y, w) => {
          pen.text(s.name, x, y + 5, pen.fit(s.name, st.rowName, w));
          return pen.paragraph(s.summary, x, y + 6, w, st.body) - y + 1;
        }),
      ];
    case "scoreColumn":
      return [
        ...titled(c, s),
        ...s.scores.map((sc) =>
          measured(c, s, (x, y, w) => {
            const base = y + 4;
            pen.text(sc.label, x, base, pen.fit(sc.label, st.body, w - 24));
            const value = sc.derived === null ? sc.value : `${sc.derived} (${sc.value})`;
            pen.text(value, x + w, base, st.value, "right");
            pen.line(x, base + 1, x + w, base + 1, 0.3, RULE);
            return g.box.row;
          }),
        ),
      ];
    case "checkList":
      return checkBlocks(c, s);
    case "statBoxes":
      return boxRowBlocks(c, s);
    case "statTable":
      return statTableBlocks(c, s);
    case "featureTable":
      return featureBlocks(c, s);
    case "list":
      return listBlocks(c, s);
    case "answers":
      return answerBlocks(c, s);
    case "notes":
      return notesBlocks(c, s);
    case "helpBox":
      return [];
  }
}

// ------------------------------------------------------------------ flow

interface Frame {
  /** From 1. */
  page: number;
  x: number;
  y: number;
  w: number;
  bottom: number;
  /** The left one of two columns: notes that end it take the right one too. */
  left?: boolean;
}

interface Item {
  block: Block;
  frame: Frame;
  y: number;
}

/**
 * Places blocks in columns, in order. A title stays with the block after it;
 * a section that goes on in the next column starts there with "Title ·
 * continued". `next(i)` gives column i, more pages as needed.
 */
class Flow {
  readonly placed: Item[] = [];
  private i = 0;
  frame: Frame;
  at: number;
  private title: { section: SheetSection; text: string } | null = null;
  private readonly c: Ctx;
  private readonly next: (i: number) => Frame;

  constructor(c: Ctx, next: (i: number) => Frame) {
    this.c = c;
    this.next = next;
    this.frame = next(0);
    this.at = this.frame.y;
  }

  get page(): number {
    return this.frame.page;
  }

  private get fresh(): boolean {
    return this.at <= this.frame.y + 0.1;
  }

  /** Places blocks; with `limit` columns, returns those that would have gone beyond the last one. */
  place(blocks: Block[], limit = Infinity): Block[] {
    // The last block may shrink to the room left (notes), so it is measured at its least.
    const least = (j: number) => (j === blocks.length - 1 ? (blocks[j]!.shrink ?? blocks[j]!) : blocks[j]!);
    for (let k = 0; k < blocks.length; k++) {
      let b = blocks[k]!;
      const full = b.h(this.frame.w);
      if (b !== least(k) && !this.fresh && this.at + full > this.frame.bottom) b = least(k);
      const last = this.placed.at(-1)?.block.section ?? null;
      if (b.title !== undefined) this.title = b.section && { section: b.section, text: b.title };
      if (b.section !== last && !this.fresh) this.at += this.c.g.rowGap;
      let h = b.h(this.frame.w);
      // A title or heading stays with what follows it, as far as that is kept with more.
      let need = h;
      for (let j = k; (blocks[j]!.title !== undefined || blocks[j]!.keep) && j + 1 < blocks.length; j++)
        need += least(j + 1).h(this.frame.w);
      if (this.at + need > this.frame.bottom && !this.fresh) {
        if (this.i + 1 >= limit) return blocks.slice(k);
        this.nextColumn();
        h = b.h(this.frame.w);
        if (b.title === undefined && b.section !== null && this.title?.section === b.section) {
          const t = titleBlock(this.c, b.section, `${this.title.text} · ${this.c.m.continued}`);
          this.placed.push({ block: t, frame: this.frame, y: this.at });
          this.at += this.c.g.titleHeight;
        }
      }
      this.placed.push({ block: b, frame: this.frame, y: this.at });
      this.at += h + 0.6;
    }
    return [];
  }

  nextColumn(): void {
    this.frame = this.next(++this.i);
    this.at = this.frame.y;
  }

  /** Lines down to the end of the column, as far as they would not be cut. */
  fillColumn(section: SheetSection | null): void {
    const n = Math.floor((this.frame.bottom - this.at - 1) / this.c.g.writingLine);
    if (n <= 0) return;
    this.placed.push({ block: linesBlock(this.c, n, section), frame: this.frame, y: this.at });
    this.at += n * this.c.g.writingLine;
  }

  /** Notes that come last take the rest of their column, and the column beside it on the same page. */
  finish(): void {
    const last = this.placed.at(-1);
    if (!last?.block.fill) return;
    const lines = Math.floor((last.frame.bottom - last.y - 1) / this.c.g.writingLine);
    last.block = last.block.fill(lines);
    if (last.frame.left) {
      const right = this.next(this.i + 1);
      if (right.page !== last.frame.page) return;
      const n = Math.floor((right.bottom - right.y - 1) / this.c.g.writingLine);
      if (n > 0)
        this.placed.push({ block: linesBlock(this.c, n, last.block.section), frame: right, y: right.y });
    }
  }
}

/** The first rows of a section that went on elsewhere get its title again, marked as continued. */
function continued(c: Ctx, blocks: Block[]): Block[] {
  const first = blocks[0];
  if (!first || first.title !== undefined || first.section === null) return blocks;
  const title = first.section.kind === "header" ? "" : first.section.title;
  return title === "" ? blocks : [titleBlock(c, first.section, `${title} · ${c.m.continued}`), ...blocks];
}

/**
 * Where `blocks` that all fit in the fresh left column of `flow` split into
 * two columns of about equal length, as the screen's columns show them: at
 * the start of a section, so none goes on in the other column. 0: they stay
 * as they come (they need both columns anyway, or are one section).
 */
function balance(c: Ctx, flow: Flow, blocks: Block[]): number {
  const frame = flow.frame;
  if (!frame.left || flow.at > frame.y + 0.1) return 0;
  const height = (part: Block[]) => {
    const f = new Flow(c, () => frame);
    return f.place(part, 1).length === 0 ? f.at - frame.y : Infinity;
  };
  if (height(blocks) === Infinity) return 0;
  let best = { at: 0, h: Infinity };
  blocks.forEach((b, k) => {
    if (k === 0 || b.section === blocks[k - 1]!.section) return;
    const h = Math.max(height(blocks.slice(0, k)), height(blocks.slice(k)));
    if (h < best.h) best = { at: k, h };
  });
  return best.at;
}

// ------------------------------------------------------------------ the sheet

/** The classic sheet laid out: what is where on each page, and how to draw a page. */
export interface ClassicSheet {
  pages: Placed[][];
  /** Draws page `n` (from 0) on the pen's current page. */
  draw: (n: number) => void;
}

/**
 * Lays out the sheet in the classic design. `bottomOf(n)` is the lowest a
 * block on page `n` (from 0) may reach.
 */
export function layClassic(
  pen: Pen,
  g: ClassicGeometry,
  sections: readonly SheetSection[],
  bottomOf: (page: number) => number,
): ClassicSheet {
  const c: Ctx = { pen, g, st: classicStyles(g), m: pen.messages };
  const plan: ClassicPlan = classicPlan(sections);
  const part = (p: keyof ClassicPlan["parts"]) => plan.parts[p].map((i) => sections[i]!);
  const bottom = (page: number) => bottomOf(page - 1);
  const cols = firstColumns(g);
  const width = contentWidth(g);
  const items: Item[] = [];
  const at = (block: Block | null, frame: Frame) => {
    if (block) items.push({ block, frame, y: frame.y });
    return block ? frame.y + block.h(frame.w) : frame.y;
  };
  const p1 = (x: number, y: number, w: number): Frame => ({ page: 1, x, y, w, bottom: bottom(1) });

  const header = part("header")[0] as Section<"header"> | undefined;
  const top = header ? at(headerBlock(c, header), p1(g.margin, g.margin, width)) + g.first.gap : g.margin;

  // Column C: the boxes at the table.
  const clustered = part("cluster") as Section<"statBoxes">[];
  const cluster = clusterBlock(c, clustered);
  const cTop = cluster ? at(cluster, p1(cols.c.x, top, cols.c.w)) + 4 : top;
  // The boxes of all of them are in that one block; the others are there too.
  for (const s of clustered.slice(1))
    at(
      measured(c, s, () => 0),
      p1(cols.c.x, top, cols.c.w),
    );

  // Column A: the scores; their further numbers top of B.
  const scores = part("scores")[0] as Section<"scoreColumn"> | undefined;
  const aBottom = scores ? at(scoresBlock(c, scores), p1(cols.a.x, top, cols.a.w)) : top;
  const extras = scores ? extrasBlock(c, scores) : null;
  const bTop = extras ? at(extras, p1(cols.b.x, top, cols.b.w)) + g.first.gap : top;

  // Column B: check lists and the boxes after the scores; then the band under A and B.
  const bandW = cols.a.w + g.first.gap + cols.b.w;
  const left: Flow = new Flow(c, (i): Frame =>
    i === 0
      ? { ...p1(cols.b.x, bTop, cols.b.w), bottom: bottom(1) - g.first.bandMin }
      : p1(cols.a.x, Math.max(aBottom, left.at) + 4, bandW),
  );
  const bRoom = bottom(1) - g.first.bandMin - bTop;
  for (const s of part("checks") as Section<"checkList">[]) {
    const framed =
      left.page === 1 && left.frame.x === cols.b.x
        ? framedChecks(c, s, cols.b.w, bRoom - (left.at - bTop))
        : null;
    left.place(framed ? [framed] : checkBlocks(c, s), 2);
  }
  const leftovers: Block[] = [];
  for (const s of part("side") as Section<"statBoxes">[]) leftovers.push(...left.place(sideBlocks(c, s), 2));
  const lists = part("band") as Section<"list">[];
  if (lists.length > 0 && leftovers.length === 0) {
    if (left.frame.x === cols.b.x) left.nextColumn();
    lists.forEach((s, i) => {
      if (leftovers.length > 0) return void leftovers.push(...listBlocks(c, s));
      const room = i === lists.length - 1 ? left.frame.bottom - left.at : 0;
      leftovers.push(...left.place(listBlocks(c, s, room), 2));
    });
  } else for (const s of lists) leftovers.push(...listBlocks(c, s));

  // Column C below the boxes, then two columns a page.
  const later =
    (page: number, y0: number) =>
    (i: number): Frame => {
      const p = page + Math.floor(i / 2);
      const x = i % 2 === 0 ? g.margin : g.margin + (width + g.columnGap) / 2;
      return {
        page: p,
        x,
        y: p === page ? y0 : g.margin + g.continuationHead,
        w: (width - g.columnGap) / 2,
        bottom: bottom(p),
        left: i % 2 === 0,
      };
    };
  const pageTwo = later(2, g.margin + g.continuationHead);
  const main = new Flow(c, (i) => (i === 0 ? p1(cols.c.x, cTop, cols.c.w) : pageTwo(i - 1)));
  const right = part("right");
  main.place(right.flatMap((s) => otherBlocks(c, s)));
  const apartSections = part("apart");
  const after = [
    ...continued(c, leftovers),
    ...(plan.apartPage ? [] : apartSections.flatMap((s) => otherBlocks(c, s))),
    ...part("later").flatMap((s) => otherBlocks(c, s)),
  ];
  // Page 2 starts with what is left; the rest of column C gets lines to write more by hand.
  if (main.page === 1) {
    main.fillColumn(right.at(-1) ?? null);
    if (after.length > 0) main.nextColumn();
  }
  const split = balance(c, main, after);
  if (split > 0) {
    main.place(after.slice(0, split));
    main.nextColumn();
    main.place(after.slice(split));
  } else main.place(after);

  /**
   * The apart part (box rows across the page, the rest in two columns of
   * about equal length) from `y0` on `page`. With `only`, null unless all of
   * it fits on that page. A short rest stays in one column.
   */
  const layApart = (page: number, y0: number, only: boolean): Item[] | null => {
    const wide = new Flow(c, () => ({ page, x: g.margin, y: y0, w: width, bottom: bottom(page) }));
    const boxes = apartSections.filter((s) => s.kind === "statBoxes");
    if (
      wide.place(
        boxes.flatMap((s) => boxRowBlocks(c, s as Section<"statBoxes">)),
        1,
      ).length > 0 &&
      only
    )
      return null;
    const rest = apartSections.filter((s) => s.kind !== "statBoxes").flatMap((s) => otherBlocks(c, s));
    const restTop = wide.placed.length > 0 ? wide.at + g.rowGap : y0;
    const fits = (end: number, n = 2) => {
      const f = new Flow(c, (i) => ({
        ...later(page, restTop)(i),
        bottom: Math.min(end, bottom(page + Math.floor(i / 2))),
      }));
      return f.place(rest, n).length === 0 ? f : null;
    };
    let columns = fits(Math.min(restTop + SHORT_REST, bottom(page)), 1);
    if (!columns) {
      let lo = restTop + 10;
      let hi = bottom(page);
      columns = fits(hi);
      if (columns) {
        while (hi - lo > 1) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) hi = mid;
          else lo = mid;
        }
        columns = fits(hi)!;
      } else if (only) return null;
      else {
        columns = new Flow(c, later(page, restTop));
        columns.place(rest);
      }
    }
    return [...wide.placed, ...columns.placed];
  };

  const placedSoFar = [...items, ...left.placed, ...main.placed];
  // The apart part has a page of its own. Only when it would fill less than 40 % of that page, it
  // goes under the last page's end if all of it fits there; the notes then keep their lines.
  const lastPage = Math.max(1, ...placedSoFar.map((p) => p.frame.page));
  const pageTop = g.margin + g.continuationHead;
  const own = plan.apartPage ? layApart(lastPage + 1, pageTop, false)! : [];
  const ownEnd = Math.max(pageTop, ...own.map((p) => p.y + p.block.h(p.frame.w)));
  const end = Math.max(
    0,
    ...placedSoFar.filter((p) => p.frame.page === lastPage).map((p) => p.y + p.block.h(p.frame.w)),
  );
  const short =
    own.every((p) => p.frame.page === lastPage + 1) &&
    ownEnd - pageTop < 0.4 * (bottom(lastPage + 1) - pageTop);
  const under = own.length > 0 && short && lastPage > 1 ? layApart(lastPage, end + 2 * g.rowGap, true) : null;
  if (!under) main.finish();
  placedSoFar.push(...(under ?? own));

  // Per page, in the design's order (the screen's order on a phone); a section's own blocks keep theirs.
  const rank = new Map(plan.order.map((i, k) => [sections[i]!, k]));
  const rankOf = (it: Item) => (it.block.section ? (rank.get(it.block.section) ?? Infinity) : Infinity);
  const indexed = placedSoFar.map((it, k) => ({ it, k, r: rankOf(it) }));
  // Lines that belong to no section stay where they came, after the section placed before them.
  indexed.forEach((e, k) => {
    if (e.r === Infinity && k > 0) e.r = indexed[k - 1]!.r;
  });
  indexed.sort((a, b) => a.it.frame.page - b.it.frame.page || a.r - b.r || a.k - b.k);
  const pages: Item[][] = [];
  for (const { it } of indexed) (pages[it.frame.page - 1] ??= []).push(it);
  for (let i = 0; i < pages.length; i++) pages[i] ??= [];
  return {
    pages: pages.map((p) =>
      p.flatMap((it) =>
        it.block.section ? [{ section: it.block.section, x: it.frame.x, y: it.y, w: it.frame.w }] : [],
      ),
    ),
    draw: (n) => {
      for (const it of pages[n] ?? []) it.block.draw(it.frame.x, it.y, it.frame.w);
    },
  };
}
