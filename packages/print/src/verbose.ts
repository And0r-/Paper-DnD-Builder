/**
 * The sheet in the "verbose" design: sections in the package's order on
 * the design's grid (`@builder/sheet/designs/verbose`), hints under titles
 * and boxes, the help box. Every measure of the grid comes from that
 * geometry, which the screen reads too.
 *
 * With a play state on the pen, what was written and ticked at the table
 * is drawn into the fields: numbers and texts where the player writes,
 * crosses in boxes and circles (never more than a field has), text on the
 * lines of notes and lists. A field the sheet does not have is skipped.
 */
import { columnLeft, contentWidth, spanWidth, type GridGeometry } from "@builder/sheet/designs";
import { steps, type Messages, type RowGroup, type SheetSection, type StatBox } from "@builder/sheet";
import {
  drawUses,
  hint,
  INK,
  MM_PER_PT,
  S,
  sectionTitle,
  usesWidth,
  type Pen,
  type TextStyle,
} from "./pen.ts";

/** A section as laid out: notes and lists may carry the play state's lines to write on them. */
export type Laid = SheetSection & { written?: string[] | undefined };

/** What the painter draws with: the pen, the design's grid and its type. */
export interface Grid {
  pen: Pen;
  g: GridGeometry;
  st: Styles;
}

type Styles = typeof S & { written: TextStyle; pencil: TextStyle };

/** The shared styles at the sizes of the geometry; play state in ink blue, as written by hand. */
export function gridStyles(g: GridGeometry): Styles {
  const t = g.type;
  return {
    ...S,
    name: { ...S.name, size: t.name },
    summary: { ...S.summary, size: t.summary },
    sectionTitle: { ...S.sectionTitle, size: t.sectionTitle },
    bigValue: { ...S.bigValue, size: t.bigValue },
    body: { ...S.body, size: t.body },
    hint: { ...S.hint, size: t.hint },
    footer: { ...S.footer, size: t.footer },
    written: { font: "semibold", size: t.body, color: INK },
    pencil: { font: "bold", size: 14, color: INK },
  };
}

/**
 * The sections with the play state's text on notes and lists, wrapped to
 * the width of their columns. A section gets as many lines as its text
 * needs, so nothing written is lost; the rest of the play state is read
 * while drawing.
 */
export function withWriting(c: Grid, sections: readonly SheetSection[]): Laid[] {
  const { pen, g, st } = c;
  return sections.map((s) => {
    if (s.kind !== "notes" && s.kind !== "list") return s;
    const text = pen.written(s.field);
    if (text === "") return s;
    const written = pen.wrap(text, st.written, spanWidth(g, s.span) - 2).filter((l) => l.trim() !== "");
    if (s.kind === "notes") return { ...s, lines: Math.max(s.lines, written.length), written };
    return { ...s, blankLines: Math.max(s.blankLines, written.length), written };
  });
}

/** Draws a placed section. */
export function drawPlaced(c: Grid, p: Placed): void {
  drawSection(c, p.section, p.x, p.y, p.w);
}

function drawRowGroup(c: Grid, group: RowGroup, x: number, y: number, w: number, first: boolean): number {
  const { pen, st } = c;
  if (!first) pen.line(x, y - 0.6, x + w, y - 0.6, 0.6, "#555");
  const top = y + 0.3;
  const baseline = top + st.rowGroup.size * 0.8 * MM_PER_PT;
  const title = pen.fit(group.title, st.rowGroup, w);
  pen.text(group.title, x, baseline, title);
  let bottom = top + pen.lineHeight(st.rowGroup, 1.1);
  if (group.hint !== "") {
    const after = pen.width(group.title, title) + 3;
    if (pen.width(group.hint, st.hint) <= w - after) pen.text(group.hint, x + after, baseline, st.hint);
    else bottom = pen.paragraph(group.hint, x, bottom, w, st.hint, 1.15);
  }
  return bottom;
}

/**
 * Draws one section (or only measures it, if the pen is dry), with the play
 * state written in where the pen has one. Returns its height.
 */
function drawSection(c: Grid, s: Laid, x: number, top: number, w: number): number {
  const { pen, g, st } = c;
  if (s.kind === "header") return drawHeader(c, s, x, top, w);
  let y = sectionTitle(pen, s.title, x, top, w, g.titleHeight, st.sectionTitle);
  switch (s.kind) {
    case "statBoxes":
      y = drawStatBoxes(c, s.boxes, x, y, w);
      break;
    case "scoreColumn":
      for (const sc of s.scores) {
        const label = pen.label(sc.label, st.fieldName, w - 25);
        const labelLh = pen.lineHeight(label.style, 1.15);
        // The derived label shares the top line with the label if both fit;
        // else it gets lines of its own above it, so the two never overlap.
        const besideW = w - 5 - pen.width(label.lines[0]!, label.style) - 3;
        const beside = sc.derived !== null && pen.width(sc.derivedLabel, st.hint) <= besideW;
        const above = sc.derived === null || beside ? [] : pen.wrap(sc.derivedLabel, st.hint, w - 4);
        const aboveLh = pen.lineHeight(st.hint, 1.15);
        const top = y + above.length * aboveLh;
        const h = 19 + (top - y) + (label.lines.length - 1) * labelLh;
        const body = top + (label.lines.length - 1) * labelLh;
        pen.rect(x, y, w, h, { width: 0.7, radius: 1.5 });
        above.forEach((l, j) => pen.text(l, x + w - 2, y + 3.4 + j * aboveLh, st.hint, "right"));
        label.lines.forEach((l, j) => pen.text(l, x + 3, top + 5 + j * labelLh, label.style));
        const valueStyle = pen.fit(sc.value, st.scoreValue, w - 25, 12);
        pen.text(sc.value, x + 3, body + 15.5, valueStyle);
        if (sc.extra) {
          // Between the score and the circle: a small label over the number, both ending on the score's baseline.
          const left = x + 3 + pen.width(sc.value, valueStyle) + 3;
          const right = sc.derived !== null ? x + w - 19 : x + w - 3;
          const value = pen.fit(sc.extra.value, st.extraValue, right - left, 8);
          const label = pen.label(sc.extra.label, st.hint, right - left);
          const lh = pen.lineHeight(label.style, 1.1);
          pen.text(sc.extra.value, left, body + 15.5, value);
          label.lines.forEach((l, j) =>
            pen.text(l, left, body + 11.2 - (label.lines.length - 1 - j) * lh, label.style),
          );
        }
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
          if (beside) pen.text(sc.derivedLabel, x + w - 2, y + 3.4, st.hint, "right");
        }
        y += h + 3;
      }
      y -= 3;
      break;
    case "checkList": {
      const columns = w >= 90 ? 2 : 1;
      const cw = (w - (columns - 1) * 4) / columns;
      const laid = s.items.map((item) => {
        const noteW = item.note === "" ? 0 : Math.min(pen.width(item.note, st.hint), (cw - 15) / 2);
        const name = pen.label(item.name, st.body, cw - 15 - (noteW > 0 ? noteW + 2 : 0));
        const note = pen.label(item.note, st.hint, Math.max(noteW, 1));
        const lh = pen.lineHeight(name.style, 1.15);
        // Where the number in the box comes from, small under the name.
        const parts = item.total.parts === "" ? [] : pen.wrap(item.total.parts, st.hint, cw - 10.5);
        const partsLh = pen.lineHeight(st.hint, 1.15);
        // A name, note or origin that needs more lines makes its row taller.
        const extra =
          Math.max((name.lines.length - 1) * lh, (note.lines.length - 1) * pen.lineHeight(note.style, 1.15)) +
          parts.length * partsLh;
        return { item, name, note, lh, parts, partsLh, extra };
      });
      let rowTop = y;
      for (let r = 0; r * columns < laid.length; r++) {
        const row = laid.slice(r * columns, (r + 1) * columns);
        for (const [col, { item, name, note, lh, parts, partsLh }] of row.entries()) {
          const cx = x + col * (cw + 4);
          const cy = rowTop + 4.5;
          pen.circle(cx + 2, cy - 1.3, item.strong ? 1.1 : 1.6, { fill: item.marked });
          if (item.strong) pen.circle(cx + 2, cy - 1.3, 2, { width: 0.5 });
          name.lines.forEach((l, j) => pen.text(l, cx + 5.5, cy + j * lh, name.style));
          const noteLh = pen.lineHeight(note.style, 1.15);
          note.lines.forEach((l, j) => pen.text(l, cx + cw - 9.5, cy + j * noteLh, note.style, "right"));
          pen.rect(cx + cw - 7.5, cy - 4.2, 7, 5.5, { width: 0.5, radius: 0.8 });
          // An empty box is filled in by hand; filled, the play state says what.
          const byHand = item.total.text === "" ? pen.written(item.field) : "";
          pen.field(item.field, cx + cw - 7.5, cy - 4.2, 7, 5.5, { text: byHand });
          const total = item.total.text === "" ? byHand : item.total.text;
          pen.text(total, cx + cw - 4, cy, pen.fit(total, st.boxValue, 6.4), "center");
          const partsTop = cy + (name.lines.length - 1) * lh + 0.9;
          parts.forEach((l, j) => pen.text(l, cx + 5.5, partsTop + (j + 0.8) * partsLh, st.hint));
        }
        rowTop += 7 + Math.max(...row.map((l) => l.extra));
      }
      y = rowTop;
      break;
    }
    case "featureTable": {
      // The marks get room of their own at the right end of the name column, so names wrap no sooner.
      const marksW = Math.max(0, ...s.rows.map((r) => pen.width(r.marks, st.mark)));
      const markRoom = marksW > 0 ? marksW + 1.5 : 0;
      const nameW = Math.min(36, w * 0.36) + markRoom;
      // A column for the use boxes, as wide as the widest row needs.
      const usesW = Math.max(0, ...s.rows.map((r) => usesWidth(pen, r.uses, st.small)));
      const textW = w - nameW - (usesW > 0 ? usesW + 3 : 0);
      for (const lead of s.lead) y = pen.paragraph(lead, x, y, w, st.small) + 1;
      let group: string | null = null;
      for (const row of s.rows) {
        if (row.group !== null && row.group.key !== group)
          y = drawRowGroup(c, row.group, x, y, w, row === s.rows[0]);
        // The player's own rows after the package's groups: the line of a group, no heading.
        else if (row.group === null && group !== null) {
          pen.line(x, y - 0.6, x + w, y - 0.6, 0.6, "#555");
          y += 0.6;
        }
        group = row.group?.key ?? null;
        const name = pen.wrapWords(row.name, st.fieldName, nameW - 2 - markRoom);
        const textLines = pen.wrap(row.text, st.small, textW);
        if (row.marks !== "")
          pen.text(row.marks, x + nameW - 2, y + 0.8 + st.fieldName.size * 0.8 * MM_PER_PT, st.mark, "right");
        let nameBottom = pen.lines(name.lines, x, y + 0.8, name.style, 1.2);
        if (row.note)
          nameBottom = pen.lines(pen.wrap(row.note, st.hint, nameW - 2), x, nameBottom, st.hint, 1.2);
        const textBottom = pen.lines(textLines, x + nameW, y + 0.9, st.small, 1.25);
        drawUses(pen, row.uses, x + w, y + 0.9 + st.small.size * 0.8 * MM_PER_PT, st.small, row.usesField);
        y = Math.max(nameBottom, textBottom) + 1.4;
        pen.line(x, y, x + w, y, 0.3, "#BBB");
        y += 0.6;
      }
      if (s.legend.length > 0) y = pen.paragraph(s.legend.join(" · "), x, y + 0.6, w, st.hint);
      break;
    }
    case "statTable":
      y = drawStatTable(c, s, x, y, w);
      break;
    case "list": {
      for (const item of s.items) {
        pen.text(item, x + 1, y + 4.3, pen.fit(item, st.body, w - 2));
        pen.line(x, y + 6, x + w, y + 6, 0.3, "#BBB");
        y += 6;
      }
      if (s.blankLines > 0)
        pen.field(s.field, x, y, w, s.blankLines * g.writingLine, { text: s.written?.join("\n") ?? "" });
      for (let i = 0; i < s.blankLines; i++) {
        const line = s.written?.[i];
        if (line) pen.text(line, x + 1, y + 4.3, pen.fit(line, st.written, w - 2));
        pen.line(x, y + g.writingLine, x + w, y + g.writingLine, 0.4, "#999");
        y += g.writingLine;
      }
      y += 0.5;
      break;
    }
    case "answers": {
      for (const row of s.rows) {
        pen.text(row.label, x, y + 3.4, pen.fit(row.label, st.fieldName, w));
        y += 4.4;
        if (row.text === "") {
          pen.line(x, y + 5, x + w, y + 5, 0.4, "#999");
          y += 6.5;
        } else {
          y = pen.paragraph(row.text, x, y, w, st.body) + 2;
        }
      }
      break;
    }
    case "helpBox": {
      const inner = w - 6;
      const start = y;
      let py = y + 2.5;
      for (const p of s.paragraphs.flatMap(steps)) py = pen.paragraph(p, x + 3, py, inner, st.small) + 1.5;
      const h = Math.max(py - start + 1, 12);
      pen.rect(x, start, w, h, { stroke: "#777", width: 0.4, radius: 1.5 });
      y = start + h;
      break;
    }
    case "notes": {
      const lh = g.writingLine;
      if (s.lines > 0) pen.field(s.field, x, y, w, s.lines * lh, { text: s.written?.join("\n") ?? "" });
      for (let i = 0; i < s.lines; i++) {
        const line = s.written?.[i];
        if (line) pen.text(line, x + 1, y + lh * i + 4.3, pen.fit(line, st.written, w - 2));
        pen.line(x, y + lh * (i + 1), x + w, y + lh * (i + 1), 0.4, "#999");
      }
      y += lh * s.lines + 0.5;
      break;
    }
  }
  // What ◉ means follows the hint, which says what ● means.
  const after = s.kind === "checkList" ? s.legend : [];
  y = hint(pen, [s.hint, ...after].filter((t) => t !== "").join(" "), x, y, w, st.hint);
  return y - top;
}

/**
 * A row per thing: its name, then one column per stat. Each column is as
 * wide as its label and longest entry need, so a number or a dice roll is
 * never broken; what is left goes to the names.
 */
function drawStatTable(
  c: Grid,
  s: Extract<SheetSection, { kind: "statTable" }>,
  x: number,
  y: number,
  w: number,
): number {
  const { pen, st } = c;
  const gap = 2.5;
  const wrap = s.columns.map((_, i) => s.wrap?.[i] === true);
  // Words in a wrapping column are lighter than the numbers: they are read when needed.
  const cellStyle = (i: number) => (wrap[i] ? st.small : st.fieldName);
  const natural = s.columns.map((label, i) =>
    Math.max(pen.width(label, st.cardLabel), ...s.rows.map((r) => pen.width(r.cells[i]!, cellStyle(i)))),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const minName = Math.min(28, w * 0.3);
  const room = w - minName - s.columns.length * gap;
  // Columns that keep to one line get their width first; a wrapping column
  // shares what is left with the names, never more than it needs.
  const fixed = natural.map((n, i) => (wrap[i] ? 0 : n));
  const scale = Math.min(1, room / Math.max(1, sum(fixed)));
  const longestName = Math.max(0, ...s.rows.map((r) => pen.width(r.name, st.fieldName))) + 1;
  const free = room - sum(fixed) * scale;
  const wrapNatural = sum(natural.filter((_, i) => wrap[i]));
  const nameShare = Math.max(0, Math.min(longestName - minName, free * 0.4));
  const wrapRoom = Math.min(wrapNatural, free - nameShare);
  const widths = natural.map((n, i) =>
    wrap[i]
      ? Math.max(pen.width(s.columns[i]!, st.cardLabel), (wrapRoom * n) / Math.max(1, wrapNatural))
      : n * scale,
  );
  const nameW = w - sum(widths) - s.columns.length * gap;
  const left = widths.map((_, i) => x + nameW + gap + widths.slice(0, i).reduce((a, b) => a + b + gap, 0));
  const labels = s.columns.map((label, i) => pen.label(label, st.cardLabel, widths[i]!));
  const labelLh = pen.lineHeight(st.cardLabel, 1.15);
  labels.forEach((l, i) => l.lines.forEach((t, j) => pen.text(t, left[i]!, y + 2.5 + j * labelLh, l.style)));
  y += 1 + Math.max(1, ...labels.map((l) => l.lines.length)) * labelLh;
  pen.line(x, y, x + w, y, 0.5, "#777");
  for (const row of s.rows) {
    const top = y + 0.8;
    const name = pen.wrapWords(row.name, st.fieldName, nameW - 1);
    let bottom = pen.lines(name.lines, x, top, name.style, 1.2);
    row.cells.forEach((cell, i) => {
      bottom = Math.max(
        bottom,
        pen.lines(pen.wrap(cell, cellStyle(i), widths[i]!), left[i]!, top, cellStyle(i), 1.2),
      );
    });
    y = bottom + 1.4;
    pen.line(x, y, x + w, y, 0.3, "#BBB");
    y += 0.6;
  }
  return y;
}

function drawHeader(
  c: Grid,
  s: Extract<SheetSection, { kind: "header" }>,
  x: number,
  y: number,
  w: number,
): number {
  const { pen, g, st } = c;
  const side = Math.min(60, w * 0.35);
  pen.text(s.name, x, y + 8, pen.fit(s.name, st.name, w - side - 4, 14));
  pen.text(s.summary, x, y + 14.5, pen.fit(s.summary, st.summary, w - side - 4, 8));
  pen.text(s.packageName, x + w, y + 4, pen.fit(s.packageName, st.meta, side), "right");
  pen.text(pen.messages.playedBy, x + w - side, y + 11.5, st.meta);
  pen.line(x + w - side, y + 15, x + w, y + 15, 0.4, "#777");
  const player = pen.written(s.playedByField);
  pen.field(s.playedByField, x + w - side, y + 12, side, 3, { text: player });
  if (player !== "") pen.text(player, x + w - side, y + 14.4, pen.fit(player, st.written, side, g.type.min));
  let rule = y + 18.5;
  if (s.fields.length > 0) {
    // One cell per answer: its label small, then the answer; an open one gets a line to write on.
    // Cells are as wide as they need and share what is left, so a short answer leaves room to a long one.
    const gap = 4;
    const room = w - (s.fields.length - 1) * gap;
    const OPEN_LINE = 25;
    const need = s.fields.map(
      (f) =>
        pen.width(f.label, st.fieldLabel) +
        2 +
        (f.text === "" ? OPEN_LINE : pen.width(f.text, st.fieldValue)),
    );
    const total = need.reduce((a, b) => a + b, 0);
    const widths = need.map((n) =>
      total <= room ? n + (room - total) / s.fields.length : (room * n) / total,
    );
    let cx = x;
    s.fields.forEach((f, i) => {
      const cw = widths[i]!;
      const label = pen.fit(f.label, st.fieldLabel, cw * 0.45);
      const lw = pen.width(f.label, label) + 2;
      pen.text(f.label, cx, y + 21, label);
      if (f.text === "") pen.line(cx + lw, y + 21.5, cx + cw, y + 21.5, 0.4, "#999");
      else pen.text(f.text, cx + lw, y + 21, pen.fit(f.text, st.fieldValue, cw - lw, 7));
      cx += cw + gap;
    });
    rule = y + 23.5;
  }
  pen.line(x, rule, x + w, rule, 1);
  return rule - y + 0.5;
}

const SQUARE = 3.2;
const SQUARE_GAP = 1.4;

/** Squares per row in a box `bw` wide, and how many rows `n` of them take. */
function squareRows(n: number, bw: number): { perRow: number; rows: number } {
  const perRow = Math.max(1, Math.floor((bw - 6 + SQUARE_GAP) / (SQUARE + SQUARE_GAP)));
  return { perRow, rows: Math.ceil(n / perRow) };
}

function drawStatBoxes(c: Grid, boxes: StatBox[], x: number, y: number, w: number): number {
  const { pen, g, st } = c;
  const n = boxes.length;
  const bw = (w - (n - 1) * 4) / n;
  const hints = boxes.map((b) => pen.wrap(b.hint, st.hint, bw - 3).filter((l) => l !== ""));
  // Labels and hints are never cut: all boxes grow to the longest one.
  const labels = boxes.map((b) => pen.label(b.label, st.sectionTitle, bw - 3, 7, true));
  const labelLh = pen.lineHeight(st.sectionTitle, 1.15);
  const extra = (Math.max(1, ...labels.map((l) => l.lines.length)) - 1) * labelLh;
  // More squares than fit a row go on in more rows; the boxes grow for them.
  const squaresExtra =
    Math.max(0, ...boxes.map((b) => squareRows(b.squares, bw).rows - 1)) * (SQUARE + SQUARE_GAP);
  const h = 22.5 + extra + squaresExtra + Math.max(1, ...hints.map((l) => l.length)) * 2.7;
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
      // Filled in: under the words, as if written in pencil.
      const now = pen.written(b.field);
      pen.field(b.field, fx, top + 8, fw, 11, { text: now });
      const what = pen.label(pen.messages.pencil, { size: 7, color: "#555" }, fw - 2);
      what.lines.forEach((l, j) => pen.text(l, fx + 1, top + 10.6 + j * 2.6, what.style));
      if (now !== "") pen.text(now, mid, top + 17.8, pen.fit(now, st.pencil, fw - 2, g.type.min), "center");
    } else if (b.style === "boxes") {
      // With a text ("5 × d10") the squares go under it, like circles; alone, they take its place.
      if (b.text !== "")
        pen.text(b.text, mid, top + 13.2, pen.fit(b.text, st.circlesValue, bw - 4, 9), "center");
      const { perRow, rows } = squareRows(b.squares, bw);
      const first = b.text !== "" ? top + 16.2 : top + 12.5 - ((rows - 1) * (SQUARE + SQUARE_GAP)) / 2;
      const ticked = pen.checks(b.field, b.squares);
      const widest = Math.min(perRow, b.squares) * (SQUARE + SQUARE_GAP) - SQUARE_GAP;
      pen.field(b.field, mid - widest / 2, first, widest, rows * (SQUARE + SQUARE_GAP) - SQUARE_GAP, {
        ticks: ticked,
      });
      for (let r = 0; r < rows; r++) {
        const inRow = Math.min(perRow, b.squares - r * perRow);
        const left = mid - (inRow * SQUARE + (inRow - 1) * SQUARE_GAP) / 2;
        for (let col = 0; col < inRow; col++) {
          const sx = left + col * (SQUARE + SQUARE_GAP);
          const sy = first + r * (SQUARE + SQUARE_GAP);
          pen.rect(sx, sy, SQUARE, SQUARE, { width: 0.6 });
          if (r * perRow + col < ticked) pen.tick(sx + SQUARE / 2, sy + SQUARE / 2, SQUARE);
        }
      }
    } else if (b.style === "circles") {
      // The number as well as the circles: how many is read at a glance, the circles are for ticking.
      pen.text(b.text, mid, top + 13.2, pen.fit(b.text, st.circlesValue, bw - 4, 12), "center");
      const step = Math.min(5.5, (bw - 6) / Math.max(1, b.circles));
      const r = Math.min(1.9, step * 0.38);
      const ticked = pen.checks(b.field, b.circles);
      const span = (b.circles - 1) * step + 2 * r;
      pen.field(b.field, mid - span / 2, top + 17.9 - r, Math.max(0, span), 2 * r, { ticks: ticked });
      for (let i = 0; i < b.circles; i++) {
        const cx = mid + (i - (b.circles - 1) / 2) * step;
        pen.circle(cx, top + 17.9, r, { width: 0.6 });
        if (i < ticked) pen.tick(cx, top + 17.9, 2 * r);
      }
    } else {
      pen.text(b.text, mid, top + 18, pen.fit(b.text, st.bigValue, bw - 4, 12), "center");
    }
    hints[i]!.forEach((l, j) => pen.text(l, mid, top + squaresExtra + 23.8 + j * 2.7, st.hint, "center"));
  });
  return y + h;
}

export interface Placed {
  section: Laid;
  x: number;
  /** Top on its page. */
  y: number;
  w: number;
}

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
function partCount(s: Laid): number {
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
function splitSection(s: Laid, n: number, m: Messages): [Laid, Laid] {
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
        { ...head, kind: s.kind, items: s.items.slice(0, n), legend: [] },
        { ...tail, kind: s.kind, items: s.items.slice(n), legend: s.legend },
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
      // What is written on the blank lines goes with them.
      const items = Math.min(n, s.items.length);
      const blank = n - items;
      return [
        {
          ...head,
          kind: s.kind,
          items: s.items.slice(0, items),
          blankLines: blank,
          written: s.written?.slice(0, blank),
        },
        {
          ...tail,
          kind: s.kind,
          items: s.items.slice(items),
          blankLines: s.blankLines - blank,
          written: s.written?.slice(blank),
        },
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
        { ...head, kind: s.kind, lines: n, written: s.written?.slice(0, n) },
        { ...tail, kind: s.kind, lines: s.lines - n, written: s.written?.slice(n) },
      ];
  }
}

/**
 * Places the sections on the design's grid, top to bottom (print layout
 * 2.1). A section goes into the columns where it can start highest, but
 * never above the section before it, so the sheet still reads in package
 * order; a short section next to a tall one moves up into the free space
 * instead of leaving a gap. A section that does not fit the page starts the
 * next one: pages break between sections, never inside a box. Only a section
 * taller than a whole page, or one whose move would leave more than
 * MAX_PAGE_GAP white, is split, between its rows, and goes on on the next
 * page under its title marked as continued; nothing is ever cut off.
 */
export function placeSections(c: Grid, sections: Laid[], bottomOf: (page: number) => number): Placed[][] {
  const { pen, g } = c;
  const columns = g.columns;
  const pages: Placed[][] = [[]];
  let bottom = bottomOf(0);
  const pageTop = (n: number) => g.margin + (n > 0 ? g.continuationHead : 0);
  let floor = new Array<number>(columns).fill(pageTop(0));
  let previousY = pageTop(0);
  /** Note lines that hold play state text never shrink away. */
  const minLines = (s: Laid & { kind: "notes" }) => Math.max(MIN_NOTE_LINES, s.written?.length ?? 0);
  const measure = (section: Laid, w: number) => {
    pen.dry = true;
    const height = drawSection(c, section, 0, 0, w);
    pen.dry = false;
    return height;
  };
  /** The most rows of `section` that fit into `room`, split off; null if not even the minimum fits. */
  const splitToFit = (section: Laid, w: number, room: number, min: number) => {
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
    let span = Math.min(columns, section.span);
    let w = spanWidth(g, span);
    let height = measure(section, w);
    const place = () => {
      let best = { col: 0, y: Infinity };
      for (let col = 0; col + span <= columns; col++) {
        const y = Math.max(previousY, ...floor.slice(col, col + span));
        if (y < best.y) best = { col, y };
      }
      return best;
    };
    let spot = place();
    // Blank note lines are the one thing that may shrink: a few fewer lines beat a page of its own.
    if (section.kind === "notes" && spot.y + height > bottom) {
      const fit = section.lines - Math.ceil((spot.y + height - bottom) / g.writingLine);
      if (fit >= minLines(section)) {
        section = { ...section, lines: fit };
        height = measure(section, w);
      }
    }
    // Taller than a whole page, or moving it would leave a large part of
    // this page white: what fits here stays (at least a few rows, else it
    // starts the next page), the rest goes on after it.
    const keep = (split: [Laid, Laid] | null) => {
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
      bottom = bottomOf(pages.length - 1);
      floor = new Array<number>(columns).fill(pageTop(pages.length - 1));
      previousY = pageTop(pages.length - 1);
      // Notes that end the sheet alone on a new page take the whole page
      // (print layout 2.1): a small box on an empty page looks broken.
      if (section.kind === "notes" && queue.length === 0) {
        span = columns;
        w = contentWidth(g);
        const frame = measure({ ...section, lines: 0 }, w);
        section = {
          ...section,
          lines: Math.max(minLines(section), Math.floor((bottom - previousY - frame) / g.writingLine)),
        };
        height = measure(section, w);
      }
      spot = place();
    }
    if (spot.y + height > bottom) keep(splitToFit(section, w, bottom - spot.y, 1));
    pages.at(-1)!.push({ section, x: columnLeft(g, spot.col), y: spot.y, w });
    for (let col = spot.col; col < spot.col + span; col++) floor[col] = spot.y + height + g.rowGap;
    previousY = spot.y;
  }
  return pages;
}
