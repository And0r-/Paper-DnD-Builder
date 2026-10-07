/**
 * The "classic" design ("Klassisch" / "Classic"): the layout of the
 * well-known three-column sheet. Scores as a narrow column on the left,
 * checks beside them, the boxes for the table top right, features on the
 * right, gear below; answers and notes on page 2. Titles and short lines
 * only: no hints, no help box (they stay in the model, this design does
 * not show them). Only the layout is borrowed; every word is the
 * package's or the builder's own.
 *
 * This file is plain data and plain functions, read by the PDF painter
 * (`@builder/print`) and the screen alike: the geometry in millimetres and
 * points, and where each section goes. A section's place follows from its
 * kind and its place in the package's order, never from what it means.
 */
import type { SheetSection, StatBox } from "../../src/model.ts";
import type { GridGeometry } from "../geometry.ts";

/**
 * The grid of the classic design is that of pages 2 on: two columns. Page 1
 * has three columns of its own (`first`), and the boxes their measures.
 */
export interface ClassicGeometry extends GridGeometry {
  first: {
    /** Height of the head (name, summary, answers box). */
    head: number;
    /** Width of the name line. */
    nameWidth: number;
    /** Columns A (scores), B (checks); C takes the rest. */
    scoresWidth: number;
    checksWidth: number;
    gap: number;
    /** Height the score boxes share in column A, gaps included. */
    scoresHeight: number;
    /** Room column B leaves at least for the band under A and B (gear). */
    bandMin: number;
  };
  box: {
    /** A score's box: at most this high, the gap between two. */
    score: number;
    scoreGap: number;
    oval: { width: number; height: number };
    /** Boxes for the table: numbers, a pencil box, marks to tick. */
    number: number;
    pencil: number;
    marks: number;
    /** Gap between two boxes in a row. */
    gap: number;
    /** A single box after the score column, in column B. */
    side: { width: number; height: number };
    /** Box rows in a column (pages 2 on): at most this wide and this high. */
    rowBox: { width: number; height: number };
    radius: number;
    /** Row of a check list, a table, a line to write on (gear). */
    row: number;
    tableRow: number;
    listLine: number;
    dot: number;
    square: number;
    circle: number;
    useBox: number;
  };
  /** Type sizes of the design beyond the grid's. */
  more: { mid: number; value: number; label: number; rowName: number };
}

export const CLASSIC_GEOMETRY: ClassicGeometry = {
  page: { width: 210, height: 297 },
  margin: 10,
  columns: 2,
  columnGap: 4,
  rowGap: 3.4,
  titleHeight: 5.6,
  footerHeight: 3,
  footerGap: 3,
  continuationHead: 9,
  writingLine: 6,
  type: {
    min: 7,
    name: 18,
    summary: 9.5,
    sectionTitle: 7.5,
    bigValue: 18,
    body: 8,
    hint: 7,
    footer: 7,
  },
  first: {
    head: 29,
    nameWidth: 76,
    scoresWidth: 30,
    checksWidth: 60,
    gap: 3,
    scoresHeight: 150,
    bandMin: 40,
  },
  box: {
    score: 30,
    scoreGap: 2.5,
    oval: { width: 13, height: 6.5 },
    number: 17,
    pencil: 24,
    marks: 17,
    gap: 2,
    side: { width: 12, height: 9 },
    rowBox: { width: 30, height: 13 },
    radius: 1.5,
    row: 5,
    tableRow: 5,
    listLine: 5.6,
    dot: 2.6,
    square: 2.8,
    circle: 3.2,
    useBox: 2.6,
  },
  more: { mid: 12, value: 9, label: 7, rowName: 8 },
};

/** Left edge and width of the three columns of page 1, in mm. */
export function firstColumns(g: ClassicGeometry): Record<"a" | "b" | "c", { x: number; w: number }> {
  const { scoresWidth: aw, checksWidth: bw, gap } = g.first;
  const a = { x: g.margin, w: aw };
  const b = { x: a.x + aw + gap, w: bw };
  const cx = b.x + bw + gap;
  return { a, b, c: { x: cx, w: g.page.width - g.margin - cx } };
}

/**
 * Where a section goes:
 * - `header`: the head of page 1;
 * - `cluster`: box rows before the score column, top right ("at the table");
 * - `scores`: the score column, column A; their further numbers top of B;
 * - `checks`: check lists, column B;
 * - `side`: box rows after the score column, small in column B;
 * - `right`: tables, column C, then on in the columns of page 2;
 * - `band`: lists, under columns A and B;
 * - `later`: answers and notes, after the right column;
 * - `apart`: a part of its own (a page, if one of them has boxes);
 * - `hidden`: help boxes, which this design does not show.
 */
export type ClassicPart =
  "header" | "cluster" | "scores" | "checks" | "side" | "right" | "band" | "later" | "apart" | "hidden";

export interface ClassicPlan {
  /** Section indices per part, in the model's order. */
  parts: Record<ClassicPart, number[]>;
  /** The apart sections have a page of their own (one of them is a box row). */
  apartPage: boolean;
  /** Every shown section, in the order the design reads: the screen's order on a phone. */
  order: number[];
}

/**
 * The plan of a sheet in the classic design, from the kinds of its sections
 * and their order only; the package's `apart` says which sections form a part
 * of their own, as nothing in a section's kind says so.
 */
export function classicPlan(sections: readonly Pick<SheetSection, "kind" | "apart">[]): ClassicPlan {
  const parts: Record<ClassicPart, number[]> = {
    header: [],
    cluster: [],
    scores: [],
    checks: [],
    side: [],
    right: [],
    band: [],
    later: [],
    apart: [],
    hidden: [],
  };
  const scoresAt = sections.findIndex((s) => s.kind === "scoreColumn");
  sections.forEach((s, i) => {
    const part = ((): ClassicPart => {
      if (s.kind === "helpBox") return "hidden";
      if (s.kind === "header") return parts.header.length === 0 ? "header" : "right";
      if (s.apart) return "apart";
      switch (s.kind) {
        case "scoreColumn":
          return i === scoresAt ? "scores" : "right";
        case "checkList":
          return "checks";
        case "statBoxes":
          return scoresAt < 0 || i < scoresAt ? "cluster" : "side";
        case "statTable":
        case "featureTable":
          return "right";
        case "list":
          return "band";
        case "answers":
        case "notes":
          return "later";
      }
    })();
    parts[part].push(i);
  });
  const apartPage = parts.apart.some((i) => sections[i]!.kind === "statBoxes");
  // On a page of their own the box rows come first, across the page; the rest after them.
  if (apartPage) {
    const boxRow = (i: number) => sections[i]!.kind === "statBoxes";
    parts.apart = [...parts.apart.filter(boxRow), ...parts.apart.filter((i) => !boxRow(i))];
  }
  const p = parts;
  const order = [
    ...p.header,
    ...p.cluster,
    ...p.scores,
    ...p.checks,
    ...p.side,
    ...p.right,
    ...p.band,
    ...(apartPage ? [] : p.apart),
    ...p.later,
    ...(apartPage ? p.apart : []),
  ];
  return { parts, apartPage, order };
}

export interface ClusterRow<T> {
  style: "numbers" | "pencil" | "marks";
  boxes: T[];
}

/**
 * The boxes at the table (those of every `cluster` section, in the model's
 * order), in rows: the printed numbers side by side, each pencil box a row
 * of its own, then everything to tick side by side.
 */
export function clusterRows<T extends Pick<StatBox, "style">>(boxes: readonly T[]): ClusterRow<T>[] {
  const numbers = boxes.filter((b) => b.style === "number");
  const pencils = boxes.filter((b) => b.style === "pencil");
  const marks = boxes.filter((b) => b.style === "circles" || b.style === "boxes");
  return [
    ...(numbers.length > 0 ? [{ style: "numbers" as const, boxes: numbers }] : []),
    ...pencils.map((b) => ({ style: "pencil" as const, boxes: [b] })),
    ...(marks.length > 0 ? [{ style: "marks" as const, boxes: marks }] : []),
  ];
}
