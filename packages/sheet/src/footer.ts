/**
 * The words of a sheet page's footer, the same on screen and in the PDF:
 * who, which sheet, the units and the page. A kept copy says which copy
 * and the level of the original it was made from ("as of level 4"). The
 * character's name comes apart, so a painter short of room can shorten it
 * first: the copy's date and time tell copies apart and stay whole. On
 * screen a copy is named by the minute it was made, as in its PDF and the
 * version menu ("Meine Fassung vom 7. Oktober, 13:15"), in the reader's
 * time zone; the PDF passes the name it printed.
 */
import { copyWhen } from "./copy-name.ts";
import { MESSAGES } from "./messages.ts";
import type { SheetModel } from "./model.ts";

export function footerWords(
  model: SheetModel,
  page: number,
  total: number,
  copyName?: string,
): { who: string; rest: string[] } {
  const m = MESSAGES[model.language];
  copyName ??= model.origin.kind === "copy" ? shownCopyName(model.language, model.origin) : "";
  const pageOf = m ? [m.page(page, total)] : [];
  const rest =
    model.origin.kind === "copy"
      ? [copyName, ...(m ? [m.asOfLevel(model.origin.fromLevel)] : []), model.unitsLine, ...pageOf]
      : [model.levelLabel, model.unitsLine, ...pageOf];
  return { who: model.name, rest };
}

function shownCopyName(language: string, origin: { name: string; createdAt: string }): string {
  const m = MESSAGES[language];
  if (!m) return origin.name;
  const at = copyWhen(language, new Date(origin.createdAt));
  return m.copyNameAt(at.date, at.time);
}
