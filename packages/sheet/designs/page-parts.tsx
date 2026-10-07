/**
 * What every A4 page of a design has on screen, as in the PDF: the head of
 * the pages after the first (name and level over a line) and the footer
 * (`footerWords`: who, which sheet, units, page; the date at the right).
 * The name gives way first where the line is short; `total` 0 is a sheet
 * without pages (a phone): no page number. Class names by the
 * design's prefix ("csheet", "vsheet").
 */
import { footerWords } from "../src/footer.ts";
import type { SheetModel } from "../src/model.ts";

export function PageHead({ model, prefix }: { model: SheetModel; prefix: string }) {
  return <p className={`${prefix}__cont`}>{`${model.name} · ${model.levelLabel}`}</p>;
}

export function PageFooter({
  model,
  page,
  total,
  prefix,
}: {
  model: SheetModel;
  page: number;
  total: number;
  prefix: string;
}) {
  const words = footerWords(model, page, total);
  // Without pages (a phone), no page number.
  const { who, rest } = total > 0 ? words : { ...words, rest: words.rest.slice(0, -1) };
  return (
    <footer className={`${prefix}__footer`}>
      <span className={`${prefix}__footer-line`}>
        <span className={`${prefix}__footer-who`}>{who}</span>
        {/* Where the line wraps, a dot stays at the end of the line before (a no-break space before it). */}
        {rest.length > 0 && <span className={`${prefix}__footer-sep`}>{" · "}</span>}
        <span className={`${prefix}__footer-rest`}>{rest.join("\u00a0· ")}</span>
      </span>
      <span className={`${prefix}__footer-date`}>{model.createdOn}</span>
    </footer>
  );
}
