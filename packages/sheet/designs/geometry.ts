/**
 * The geometry of a sheet design on a grid: page, margins, columns, gaps
 * and type sizes, in millimetres and points. Plain data, read by both
 * painters of a design: the PDF (`@builder/print`, pdfkit) and the screen
 * (React, from desk width on), so paper and screen measure the same.
 */

export interface GridGeometry {
  /** The page in mm (A4 portrait). */
  page: { width: number; height: number };
  /** Margin on every side, in mm. */
  margin: number;
  /** Columns of the grid; a section spans one or more of them. */
  columns: number;
  /** Gap between two columns, in mm. */
  columnGap: number;
  /** Gap under a section before the next one in the same columns, in mm. */
  rowGap: number;
  /** Height of a section's title bar, in mm. */
  titleHeight: number;
  /** From the bottom margin up to the footer line, in mm. */
  footerHeight: number;
  /** Free room between the last section and the footer line, in mm. */
  footerGap: number;
  /** Room the head of every page after the first takes (name and level over a line), in mm. */
  continuationHead: number;
  /** Height of one blank line to write on (notes, lists), in mm. */
  writingLine: number;
  /** Type sizes in points. Nothing is ever set smaller than `min`. */
  type: {
    min: number;
    name: number;
    summary: number;
    sectionTitle: number;
    bigValue: number;
    body: number;
    hint: number;
    footer: number;
  };
}

/** Width of the area between the margins, in mm. */
export function contentWidth(g: GridGeometry): number {
  return g.page.width - 2 * g.margin;
}

/** Width of one grid column, in mm. */
export function columnWidth(g: GridGeometry): number {
  return (contentWidth(g) - (g.columns - 1) * g.columnGap) / g.columns;
}

/** Width of a section that spans `span` columns (at most all of them), in mm. */
export function spanWidth(g: GridGeometry, span: number): number {
  const n = Math.min(g.columns, Math.max(1, span));
  return n * columnWidth(g) + (n - 1) * g.columnGap;
}

/** Left edge of column `col` (from 0), in mm from the page's left edge. */
export function columnLeft(g: GridGeometry, col: number): number {
  return g.margin + col * (columnWidth(g) + g.columnGap);
}

/** The y of the footer line, in mm from the top. */
export function footerLine(g: GridGeometry): number {
  return g.page.height - g.margin - g.footerHeight;
}

/** The lowest a section may reach, in mm from the top. */
export function contentBottom(g: GridGeometry): number {
  return footerLine(g) - g.footerGap;
}
