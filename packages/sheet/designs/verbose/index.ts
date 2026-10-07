/**
 * The "verbose" design ("Ausführlich" / "Detailed"): sections in the
 * package's order on a twelve-column grid, a hint under every title and
 * box, the help box and what the marks mean. For people new to the game.
 *
 * This file is the design's geometry; the PDF painter (`@builder/print`)
 * and the screen both read it, so a box is the same size on paper and on
 * screen.
 */
import { contentBottom, type GridGeometry } from "../geometry.ts";

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

/** Where a section goes on the pages: page (from 0), first column (from 0), top in mm. */
export interface PackedSection {
  page: number;
  col: number;
  y: number;
}

/**
 * The PDF's rule for placing sections on the grid (print layout 2.1), for
 * sections already measured: top to bottom in the package's order, each
 * into the columns where it can start highest but never above the one
 * before it, so a short section moves up beside a tall one; a section that
 * does not fit starts the next page. Unlike the PDF, a section is never
 * split: where the PDF would split it (moving it would leave more than
 * `maxGap` white), it stays and makes its page longer. The screen draws a
 * little taller than paper (help never under 12 px, room to tap): a
 * section that runs past the page's foot by at most `slack` stays too, so
 * it lands where the PDF has it. Heights and the result in mm.
 */
export function packSections(
  sections: readonly { span: number; height: number }[],
  g: GridGeometry = VERBOSE_GEOMETRY,
  maxGap = 85,
  slack = 0,
): PackedSection[] {
  const columns = g.columns;
  const bottom = contentBottom(g);
  const pageTop = (n: number) => g.margin + (n > 0 ? g.continuationHead : 0);
  let page = 0;
  let floor = new Array<number>(columns).fill(pageTop(0));
  let previousY = pageTop(0);
  let onPage = 0;
  const out: PackedSection[] = [];
  for (const s of sections) {
    const span = Math.min(columns, Math.max(1, s.span));
    const place = () => {
      let best = { col: 0, y: Infinity };
      for (let col = 0; col + span <= columns; col++) {
        const y = Math.max(previousY, ...floor.slice(col, col + span));
        if (y < best.y) best = { col, y };
      }
      return best;
    };
    let spot = place();
    if (spot.y + s.height > bottom + slack && onPage > 0 && bottom - spot.y <= maxGap) {
      page++;
      onPage = 0;
      floor = new Array<number>(columns).fill(pageTop(page));
      previousY = pageTop(page);
      spot = place();
    }
    out.push({ page, col: spot.col, y: spot.y });
    onPage++;
    for (let col = spot.col; col < spot.col + span; col++) floor[col] = spot.y + s.height + g.rowGap;
    previousY = spot.y;
  }
  return out;
}
