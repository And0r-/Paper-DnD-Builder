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

/** A label at 7 pt, in two lines if one is not enough; returns its lines and style. */
function smallLabel(c: Ctx, text: string, w: number) {
  return c.pen.label(text, c.st.label, w);
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
    pen.text(s.name, x + 0.5, y + 11, pen.fit(s.name, st.name, nw - 1, 12));
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

/** Top of column B: the further number of every score that has one, as a list with circles. */
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
      pen.circle(x + 3.5, base - 1.1, g.box.dot / 2);
      pen.text(sc.extra!.value, x + 12, base, pen.fit(sc.extra!.value, st.value, 6), "right");
      pen.line(x + 6, base + 0.6, x + 12.5, base + 0.6, 0.4, LINE);
      pen.text(sc.label, x + 14, base, pen.fit(sc.label, st.body, w - 16));
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

/** Boxes in rows as wide as a column allows (slots per rank), under the section's title. */
function boxRowBlocks(c: Ctx, s: Section<"statBoxes">): Block[] {
  const { g } = c;
  const gap = g.box.gap;
  const rows = (w: number) => {
    const per = Math.max(1, Math.floor((w + gap) / (g.box.rowBox.width * 0.6 + gap)));
    const out: StatBox[][] = [];
    for (let i = 0; i < s.boxes.length; i += per) out.push(s.boxes.slice(i, i + per));
    return { per, out };
  };
  return [
    ...titled(c, s),
    // One block per row of boxes, so a long row of them can go on in the next column.
    measured(c, s, (x, y, w) => {
      const { per, out } = rows(w);
      const bw = Math.min(g.box.rowBox.width, (w - (per - 1) * gap) / per);
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
  const nameW = (w: number) =>
    Math.min(w * 0.28, Math.max(18, ...s.rows.map((r) => pen.width(r.name, st.rowName))) + 4);
  // A narrow column is as wide as its widest cell or heading; wrapping columns share the rest.
  const natural = s.columns.map(
    (col, i) =>
      Math.max(pen.width(col, st.label), ...s.rows.map((r) => pen.width(r.cells[i] ?? "", st.value)), 8) + 3,
  );
  const colW = (w: number, i: number) => {
    const rest = w - nameW(w);
    const wrapCount = s.columns.filter((_, j) => wraps(j)).length;
    const fixed = natural.reduce((a, n, j) => a + (wraps(j) ? 0 : n), 0);
    // Wrapping columns keep at least 20 mm; narrow ones give way if needed.
    const scale = Math.min(1, (rest - 20 * wrapCount) / Math.max(1, fixed));
    return wraps(i) ? (rest - fixed * scale) / Math.max(1, wrapCount) : natural[i]! * scale;
  };
  const lefts = (x: number, w: number) => {
    const out: number[] = [];
    let at = x + nameW(w);
    s.columns.forEach((_, i) => {
      out.push(at);
      at += colW(w, i);
    });
    return out;
  };
  const head = measured(
    c,
    s,
    (x, y, w) => {
      // A heading wider than its column at 7 pt takes two lines.
      let lines = 1;
      lefts(x, w).forEach((cx, i) => {
        const label = pen.label(s.columns[i]!, st.label, colW(w, i) - 1.5);
        lines = Math.max(lines, label.lines.length);
        label.lines.forEach((l, k) => pen.text(l, cx + 0.5, y + 2.6 + k * 2.8, label.style));
      });
      return 3.6 + (lines - 1) * 2.8;
    },
    { keep: true },
  );
  const row = (name: string, cells: string[]) =>
    measured(c, s, (x, y, w) => {
      // A wrapping cell makes the whole row taller.
      const rh = Math.max(
        g.box.tableRow,
        ...s.columns.map((_, i) =>
          wraps(i)
            ? pen.wrap(cells[i] ?? "", st.small, colW(w, i) - 3.5).length * pen.lineHeight(st.small, 1.1) +
              1.4
            : 0,
        ),
      );
      pen.rect(x, y + 0.4, nameW(w) - 1, rh, { width: 0.4, stroke: RULE });
      pen.text(name, x + 1, y + 3.8, pen.fit(name, st.rowName, nameW(w) - 3));
      lefts(x, w).forEach((cx, i) => {
        const cw = colW(w, i) - 1.5;
        pen.rect(cx, y + 0.4, cw, rh, { width: 0.4, stroke: RULE });
        const cell = cells[i] ?? "";
        if (wraps(i)) pen.paragraph(cell, cx + 1, y + 1.1, cw - 2, st.small, 1.1);
        else pen.text(cell, cx + cw / 2, y + 3.8, pen.fit(cell, st.value, cw - 1), "center");
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
    }
    group = r.group?.key ?? null;
    out.push(measured(c, s, (x, y, w) => featureRow(c, r, x, y, w)));
  }
  if (s.legend.length > 0)
    out.push(measured(c, s, (x, y, w) => drawLegend(c, s.legend, x, y + 1, w) + 0.5 - y));
  return out;
}

/**
 * A list on lines, two to a row; with `room` (mm), empty lines fill it. What
 * the play state wrote goes on the empty lines, in order.
 */
function listBlocks(c: Ctx, s: Section<"list">, room = 0, columns = 2): Block[] {
  const { pen, g, st } = c;
  const line = g.box.listLine;
  const cellW = (w: number) => (w - 3 * (columns - 1)) / columns;
  // Written lines are wrapped to the width of a cell in the band (columns of the same width later).
  const bandW = firstColumns(g).a.w + g.first.gap + firstColumns(g).b.w;
  const written = pen.wrap(pen.written(s.field), st.written, cellW(bandW) - 1).filter((l) => l.trim() !== "");
  const fit = Math.max(0, Math.floor((room - g.titleHeight - 1) / line)) * columns;
  const blank = Math.max(s.blankLines, written.length, fit - s.items.length);
  const cells = [
    ...s.items.map((t) => ({ t, blank: -1 })),
    ...Array.from({ length: blank }, (_, i) => ({ t: "", blank: i })),
  ];
  while (cells.length % columns !== 0) cells.push({ t: "", blank: cells.length - s.items.length });
  const rows: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  const firstBlank = rows.findIndex((r) => r.some((cell) => cell.blank >= 0));
  return [
    ...titled(c, s),
    ...rows.map((row, ri) =>
      measured(c, s, (x, y, w) => {
        const cw = cellW(w);
        const base = y + line - 1;
        if (ri === firstBlank && s.blankLines + written.length > 0)
          pen.field(s.field, x, y, w, line, { text: written.join("\n") });
        row.forEach((cell, k) => {
          const cx = x + k * (cw + 3);
          const text = cell.blank >= 0 ? (written[cell.blank] ?? "") : cell.t;
          if (text !== "")
            pen.text(
              text,
              cx + 0.5,
              base - 0.8,
              pen.fit(text, cell.blank >= 0 ? st.written : st.body, cw - 1),
            );
          pen.line(cx, base, cx + cw, base, 0.4, RULE);
        });
        return line;
      }),
    ),
  ];
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

/** Notes: lines to write on, as many as the play state's text needs; the last section's grow to the column's end. */
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
  return [...titled(c, s), lines(s.lines)];
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
    for (let k = 0; k < blocks.length; k++) {
      const b = blocks[k]!;
      const last = this.placed.at(-1)?.block.section ?? null;
      if (b.title !== undefined) this.title = b.section && { section: b.section, text: b.title };
      if (b.section !== last && !this.fresh) this.at += this.c.g.rowGap;
      let h = b.h(this.frame.w);
      // A title or heading stays with what follows it, as far as that is kept with more.
      let need = h;
      for (let j = k; (blocks[j]!.title !== undefined || blocks[j]!.keep) && j + 1 < blocks.length; j++)
        need += blocks[j + 1]!.h(this.frame.w);
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

// ------------------------------------------------------------------ the sheet

/** The classic sheet laid out: what is where on each page, and how to draw a page. */
export interface ClassicSheet {
  pages: Placed[][];
  /** Draws page `n` (from 0) on the pen's current page. */
  draw: (n: number) => void;
}

/**
 * Lays out the sheet in the classic design. `bottomOf(n)` is the lowest a
 * block on page `n` (from 0) may reach; `apart` says which sections form a
 * part of their own.
 */
export function layClassic(
  pen: Pen,
  g: ClassicGeometry,
  sections: readonly SheetSection[],
  bottomOf: (page: number) => number,
  apart?: (index: number) => boolean,
): ClassicSheet {
  const c: Ctx = { pen, g, st: classicStyles(g), m: pen.messages };
  const plan: ClassicPlan = classicPlan(sections, apart);
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
  for (const s of clustered.slice(1)) at(measured(c, s, () => 0), p1(cols.c.x, top, cols.c.w));

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
  main.place(after);
  main.finish();

  const placedSoFar = [...items, ...left.placed, ...main.placed];
  if (plan.apartPage) {
    const page = Math.max(1, ...placedSoFar.map((p) => p.frame.page)) + 1;
    const y0 = g.margin + g.continuationHead;
    const wide = new Flow(c, () => ({ page, x: g.margin, y: y0, w: width, bottom: bottom(page) }));
    const boxes = apartSections.filter((s) => s.kind === "statBoxes");
    wide.place(boxes.flatMap((s) => boxRowBlocks(c, s as Section<"statBoxes">)));
    // The rest in two columns of about equal length: the lowest bottom at which all of it fits in two.
    const rest = apartSections.filter((s) => s.kind !== "statBoxes").flatMap((s) => otherBlocks(c, s));
    const restTop = wide.placed.length > 0 ? wide.at + g.rowGap : y0;
    const fits = (end: number) => {
      const f = new Flow(c, (i) => ({
        ...later(page, restTop)(i),
        bottom: Math.min(end, bottom(page + Math.floor(i / 2))),
      }));
      return f.place(rest, 2).length === 0 ? f : null;
    };
    let lo = restTop + 10;
    let hi = bottom(page);
    let columns = fits(hi);
    if (columns) {
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      columns = fits(hi)!;
    } else {
      columns = new Flow(c, later(page, restTop));
      columns.place(rest);
    }
    placedSoFar.push(...wide.placed, ...columns.placed);
  }

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
