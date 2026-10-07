/**
 * Where the PDF puts each section of a sheet, for the screen to break its
 * pages where the paper does: the page a section starts on (from 0), the
 * column of the design's grid it starts in, and every column it takes on
 * that page (a list going on in the second column). A section the PDF
 * splits counts on the page of its first part.
 */
import { columnWidth, type GridGeometry } from "@builder/sheet/designs";
import { DESIGN_GEOMETRY, renderPdf } from "./render.ts";
import type { PlayState, SheetModel } from "@builder/sheet";
import type { Laid } from "./verbose.ts";

export interface SheetPlaces {
  /** Pages of the sheet alone. */
  pages: number;
  /** Per section of the model, in its order; null for one the design does not show. */
  sections: ({ page: number; col: number; cols: number[] } | null)[];
}

export async function sheetPlaces(
  model: SheetModel,
  { design, play }: { design: string; play?: PlayState },
): Promise<SheetPlaces> {
  const pdf = await renderPdf(model, { parts: ["sheet"], design, ...(play ? { play } : {}) });
  const g: GridGeometry = DESIGN_GEOMETRY[design]!;
  const step = columnWidth(g) + g.columnGap;
  const sections: SheetPlaces["sections"] = model.sections.map(() => null);
  pdf.sheetLayout.forEach((placed, page) => {
    for (const p of placed) {
      const from = (p.section as Laid).from ?? model.sections.indexOf(p.section);
      if (from < 0) continue;
      const col = Math.max(0, Math.round((p.x - g.margin) / step));
      const known = sections[from];
      if (!known) sections[from] = { page, col, cols: [col] };
      else if (known.page === page && !known.cols.includes(col)) known.cols.push(col);
    }
  });
  return { pages: pdf.sheetPages, sections };
}
