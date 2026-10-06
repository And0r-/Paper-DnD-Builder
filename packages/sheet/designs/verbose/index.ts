/**
 * The "verbose" design ("Ausführlich" / "Detailed"): sections in the
 * package's order on a twelve-column grid, a hint under every title and
 * box, the help box and what the marks mean. For people new to the game.
 *
 * This file is the design's geometry; the PDF painter (`@builder/print`)
 * and the screen both read it, so a box is the same size on paper and on
 * screen.
 */
import type { GridGeometry } from "../geometry.ts";

export const VERBOSE_GEOMETRY: GridGeometry = {
  page: { width: 210, height: 297 },
  margin: 12,
  columns: 12,
  columnGap: 4,
  rowGap: 6,
  titleHeight: 5,
  footerHeight: 4,
  footerGap: 3,
  continuationHead: 9,
  writingLine: 6,
  type: {
    min: 7,
    name: 22,
    summary: 11,
    sectionTitle: 8,
    bigValue: 22,
    body: 9,
    hint: 7,
    footer: 7,
  },
};
