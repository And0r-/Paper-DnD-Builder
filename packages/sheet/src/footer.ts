/**
 * The words of a sheet page's footer, the same on screen and in the PDF:
 * who, which sheet, the units and the page. A kept copy says which copy
 * and the level of the original it was made from ("as of level 4"). The
 * character's name comes apart, so a painter short of room can shorten it
 * first: the copy's date and time tell copies apart and stay whole.
 */
import { MESSAGES } from "./messages.ts";
import type { SheetModel } from "./model.ts";

export function footerWords(
  model: SheetModel,
  page: number,
  total: number,
  copyName = model.origin.kind === "copy" ? model.origin.name : "",
): { who: string; rest: string[] } {
  const m = MESSAGES[model.language];
  const pageOf = m ? [m.page(page, total)] : [];
  const rest =
    model.origin.kind === "copy"
      ? [copyName, ...(m ? [m.asOfLevel(model.origin.fromLevel)] : []), model.unitsLine, ...pageOf]
      : [model.levelLabel, model.unitsLine, ...pageOf];
  return { who: model.name, rest };
}
