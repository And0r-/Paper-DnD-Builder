/**
 * The design "verbose" (Ausführlich) on screen: the sheet as on paper, with
 * the hints under every title and box and the help box, for beginners.
 * From desk width (900 px) on, an A4 page with the twelve
 * columns of the PDF; narrower, every section is a card of its own, one
 * under the other in the model's order, with room to tap. Styles in
 * `screen.css`; grid, page and type from the design's geometry (`index.ts`), shared with the PDF.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { MESSAGES } from "../../src/messages.ts";
import { steps } from "../../src/model.ts";
import type { FeatureRow, SheetModel, SheetSection, StatBox } from "../../src/model.ts";
import { columnLeft, contentBottom, spanWidth } from "../geometry.ts";
import { PageFooter, PageHead } from "../page-parts.tsx";
import type { PrintPlaces, SheetScreenProps, SheetUi } from "../types.ts";
import { VERBOSE_GEOMETRY as G, packSections, type PackedSection } from "./index.ts";

/**
 * Measures of boxes and marks the PDF painter keeps to itself (mm), as it
 * draws them; the grid, the page and the type come from the shared geometry.
 */
const BOXES = {
  boxGap: 4,
  boxMinHeight: 22.5,
  radius: 1.5,
  square: 3.2,
  scoreHeight: 19,
  scoreCircle: 12.6,
  /** Type sizes the shared geometry does not name (pt). */
  type: { circlesValue: 15, scoreValue: 20, fieldName: 9, small: 8.5 },
};

/** The geometry as CSS variables, so the style sheet has no measure of its own. */
const pageStyle = {
  "--vs-page-w": `${G.page.width}mm`,
  "--vs-page-h": `${G.page.height}mm`,
  "--vs-margin": `${G.margin}mm`,
  "--vs-columns": String(G.columns),
  "--vs-column-gap": `${G.columnGap}mm`,
  "--vs-row-gap": `${G.rowGap}mm`,
  "--vs-title-h": `${G.titleHeight}mm`,
  "--vs-line": `${G.writingLine}mm`,
  "--vs-box-gap": `${BOXES.boxGap}mm`,
  "--vs-box-min-h": `${BOXES.boxMinHeight}mm`,
  "--vs-radius": `${BOXES.radius}mm`,
  "--vs-square": `${BOXES.square}mm`,
  "--vs-score-h": `${BOXES.scoreHeight}mm`,
  "--vs-score-circle": `${BOXES.scoreCircle}mm`,
  ...Object.fromEntries(
    Object.entries({ ...G.type, ...BOXES.type }).map(([k, v]) => [`--vs-${k}`, `${v}pt`]),
  ),
} as CSSProperties;

type Props<K extends SheetSection["kind"]> = {
  s: Extract<SheetSection, { kind: K }>;
  i: number;
  ui: SheetUi;
};

const at = (i: number, ...rest: (string | number)[]) => ["sections", i, ...rest];

/** Room between two pages on screen, in mm. */
const PAGE_GAP = 8;
const DESK = "(min-width: 900px)";
/** How far (mm) a section may run past a page's foot on screen, where it is taller than on paper. */
const SCREEN_SLACK = 40;

interface Pages {
  at: PackedSection[];
  /** Height of each page in mm: A4, longer only for a section taller than a page. */
  heights: number[];
}

/**
 * From desk width on, the sections are measured as the screen draws them
 * and placed on A4 pages. With the PDF's places (`places`), each section
 * goes on the page and into the column where the PDF starts it, so the
 * pages break where the paper's do and "page 1 of 2" is the printout's;
 * a page is drawn longer where the screen's taller sections need it. Until
 * they are known, by the PDF's rule (`packSections`) for the screen's
 * heights. The sections stay in the model's order in the document; only
 * their place on the page is set. Narrower, and before the first
 * measuring, they flow one under the other.
 */
function usePages(
  box: RefObject<HTMLDivElement | null>,
  model: SheetModel,
  places: PrintPlaces | null | undefined,
): Pages | null {
  const [pages, setPages] = useState<Pages | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const desk = window.matchMedia(DESK);
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!desk.matches) return setPages(null);
        const mm = (el.querySelector<HTMLElement>(".vsheet__mm")?.getBoundingClientRect().height ?? 0) / 100;
        const sections = [...el.querySelectorAll<HTMLElement>(":scope > .vsheet__section")];
        if (mm <= 0 || sections.length !== model.sections.length) return;
        const sized = model.sections.map((s, i) => ({
          span: s.span,
          height: sections[i]!.getBoundingClientRect().height / mm,
        }));
        const known = places && places.sections.length === sized.length ? places : null;
        const at = known ? onPrintedPages(sized, known) : packSections(sized, G, undefined, SCREEN_SLACK);
        const heights: number[] = known ? new Array<number>(known.pages).fill(G.page.height) : [];
        at.forEach((p, i) => {
          const bottom = p.y + sized[i]!.height;
          heights[p.page] = Math.max(
            heights[p.page] ?? G.page.height,
            bottom + (G.page.height - contentBottom(G)),
          );
        });
        const next = { at, heights: [...heights].map((h) => h ?? G.page.height) };
        setPages((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
      });
    };
    measure();
    const seen = new ResizeObserver(measure);
    for (const s of el.querySelectorAll(":scope > .vsheet__section")) seen.observe(s);
    desk.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      desk.removeEventListener("change", measure);
    };
  }, [box, model, places]);
  return pages;
}

/**
 * The sections on the PDF's pages, each in the PDF's column, top to bottom
 * as the PDF's rule has it (never above the one before, under what is
 * above in its columns), with the screen's heights.
 */
function onPrintedPages(
  sections: readonly { span: number; height: number }[],
  places: PrintPlaces,
): PackedSection[] {
  const pageTop = (n: number) => G.margin + (n > 0 ? G.continuationHead : 0);
  let page = -1;
  let floor: number[] = [];
  let previousY = 0;
  return sections.map((s, i) => {
    const place = places.sections[i] ?? { page: Math.max(0, page), col: 0 };
    if (place.page !== page) {
      page = place.page;
      floor = new Array<number>(G.columns).fill(pageTop(page));
      previousY = pageTop(page);
    }
    const span = Math.min(G.columns, Math.max(1, s.span));
    const col = Math.min(place.col, G.columns - span);
    const y = Math.max(previousY, ...floor.slice(col, col + span));
    for (let c = col; c < col + span; c++) floor[c] = y + s.height + G.rowGap;
    previousY = y;
    return { page, col, y };
  });
}

export function VerboseSheet({ model, ui, places }: SheetScreenProps) {
  const m = MESSAGES[model.language];
  const box = useRef<HTMLDivElement>(null);
  const pages = usePages(box, model, places);
  const tops: number[] = [];
  pages?.heights.forEach((h, p) => tops.push(p === 0 ? 0 : tops[p - 1]! + pages.heights[p - 1]! + PAGE_GAP));
  const height = pages ? tops.at(-1)! + pages.heights.at(-1)! : 0;
  return (
    <article className={`vsheet${pages ? " vsheet--paged" : ""}`} lang={model.language} style={pageStyle}>
      <div
        ref={box}
        className="vsheet__page"
        style={pages ? ({ "--vs-sheet-h": `${height}mm` } as CSSProperties) : undefined}
      >
        <span className="vsheet__mm" aria-hidden="true" />
        {model.sections.map((s, i) => {
          const spot = pages?.at[i];
          const place = spot && {
            left: `${columnLeft(G, spot.col)}mm`,
            top: `${tops[spot.page]! + spot.y}mm`,
            width: `${spanWidth(G, s.span)}mm`,
          };
          return (
            <section
              key={`${s.id}-${i}`}
              className={`vsheet__section vsheet__section--${s.kind}`}
              style={{ "--vs-span": String(Math.min(G.columns, s.span)), ...place } as CSSProperties}
              data-section={s.id}
              aria-label={s.kind === "header" ? s.name : s.title || undefined}
            >
              {s.kind !== "header" && s.title !== "" && (
                <h2 className="vsheet__title">
                  <ui.Text path={at(i, "title")} value={s.title} label={s.title} />
                </h2>
              )}
              <Section
                s={s}
                i={i}
                ui={ui}
                playedBy={m?.playedBy ?? ""}
                pencil={m?.pencil ?? ""}
                rowName={m?.rowName ?? ""}
              />
              {s.kind !== "header" && s.hint !== "" && (
                <p className="vsheet__hint">
                  <ui.Text path={at(i, "hint")} value={s.hint} label={s.title} multiline />
                </p>
              )}
              {s.kind === "checkList" && s.legend.length > 0 && (
                <p className="vsheet__hint">{s.legend.join(" ")}</p>
              )}
            </section>
          );
        })}
        {pages ? (
          pages.heights.map((h, p) => (
            <div
              key={p}
              className="vsheet__paper"
              style={{ top: `${tops[p]}mm`, height: `${h}mm` } as CSSProperties}
            >
              {p > 0 && <PageHead model={model} prefix="vsheet" />}
              <PageFooter model={model} page={p + 1} total={pages.heights.length} prefix="vsheet" />
            </div>
          ))
        ) : (
          <PageFooter model={model} page={1} total={0} prefix="vsheet" />
        )}
      </div>
    </article>
  );
}

function Section({
  s,
  i,
  ui,
  playedBy,
  pencil,
  rowName,
}: {
  s: SheetSection;
  i: number;
  ui: SheetUi;
  playedBy: string;
  pencil: string;
  rowName: string;
}): ReactNode {
  switch (s.kind) {
    case "header":
      return <Header s={s} i={i} ui={ui} playedBy={playedBy} />;
    case "statBoxes":
      return <StatBoxes s={s} i={i} ui={ui} pencil={pencil} />;
    case "scoreColumn":
      return <Scores s={s} i={i} ui={ui} />;
    case "checkList":
      return <CheckList s={s} i={i} ui={ui} />;
    case "statTable":
      return <StatTable s={s} i={i} ui={ui} rowName={rowName} />;
    case "featureTable":
      return <FeatureTable s={s} i={i} ui={ui} rowName={rowName} />;
    case "list":
      return <List s={s} i={i} ui={ui} />;
    case "answers":
      return (
        <dl className="vsheet__answers">
          {s.rows.map((r, j) => (
            <div key={j} className="vsheet__answer">
              <dt>
                <ui.Text path={at(i, "rows", j, "label")} value={r.label} label={r.label} />
              </dt>
              <dd className={r.text === "" ? "vsheet__open" : undefined}>
                <ui.Text path={at(i, "rows", j, "text")} value={r.text} label={r.label} multiline />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "helpBox":
      return (
        <div className="vsheet__help">
          {s.paragraphs.map((p, j) => (
            <p key={j}>
              <ui.Text
                path={at(i, "paragraphs", j)}
                value={p}
                shown={steps(p).join("\n")}
                label={s.title}
                multiline
              />
            </p>
          ))}
        </div>
      );
    case "notes":
      return s.field ? (
        <ui.Field field={{ id: s.field, kind: "text" }} label={s.title} lines={s.lines} />
      ) : (
        <Lines n={s.lines} />
      );
  }
}

function Lines({ n }: { n: number }) {
  return <div className="vsheet__lines" style={{ "--vs-lines": String(n) } as CSSProperties} />;
}

function Header({ s, i, ui, playedBy }: Props<"header"> & { playedBy: string }) {
  return (
    <div className="vsheet__header">
      <div className="vsheet__who">
        <h1 className="vsheet__name">
          <ui.Text path={at(i, "name")} value={s.name} label={s.name} />
        </h1>
        <p className="vsheet__summary">
          <ui.Text path={at(i, "summary")} value={s.summary} label={s.name} />
        </p>
      </div>
      <div className="vsheet__side">
        <p className="vsheet__package">{s.packageName}</p>
        {s.playedByField && (
          <label className="vsheet__played-by">
            <span>{playedBy}</span>
            <ui.Field field={{ id: s.playedByField, kind: "text" }} label={playedBy} />
          </label>
        )}
      </div>
      {s.fields.length > 0 && (
        <dl className="vsheet__fields">
          {s.fields.map((f, j) => (
            <div key={j}>
              <dt>
                <ui.Text path={at(i, "fields", j, "label")} value={f.label} label={f.label} />
              </dt>
              <dd>
                <ui.Text path={at(i, "fields", j, "text")} value={f.text} label={f.label} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function StatBoxes({ s, i, ui, pencil }: Props<"statBoxes"> & { pencil: string }) {
  return (
    <div className="vsheet__boxes" style={{ "--vs-boxes": String(s.boxes.length) } as CSSProperties}>
      {s.boxes.map((b, j) => (
        <div
          key={`${b.valueId}-${j}`}
          className={`vsheet__box vsheet__box--${b.style}`}
          style={{ "--sheet-per-row": perRow(b) } as CSSProperties}
        >
          <p className="vsheet__box-label">
            <ui.Text path={at(i, "boxes", j, "label")} value={b.label} label={b.label} />
          </p>
          <BoxBody b={b} path={at(i, "boxes", j)} ui={ui} pencil={pencil} />
          {(b.parts ?? "") !== "" && (
            <p className="vsheet__box-parts">
              <ui.Text path={at(i, "boxes", j, "parts")} value={b.parts!} label={b.label} multiline />
            </p>
          )}
          {b.hint !== "" && (
            <p className="vsheet__box-hint">
              <ui.Text path={at(i, "boxes", j, "hint")} value={b.hint} label={b.label} multiline />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Marks to tick in at most two rows at a desk: up to four in one, more in two halves. */
function perRow(b: StatBox): number {
  const n = b.style === "circles" ? b.circles : b.style === "boxes" ? b.squares : 0;
  return n <= 4 ? Math.max(1, n) : Math.ceil(n / 2);
}

function BoxBody({
  b,
  path,
  ui,
  pencil,
}: {
  b: StatBox;
  path: (string | number)[];
  ui: SheetUi;
  pencil: string;
}) {
  const value =
    b.text === "" ? null : (
      <p className="vsheet__box-value">
        <ui.Text path={[...path, "text"]} value={b.text} label={b.label} />
      </p>
    );
  if (b.style === "pencil") {
    return (
      <div className="vsheet__pencil">
        <span className="vsheet__pencil-what">{pencil}</span>
        {b.field ? (
          <ui.Field field={{ id: b.field, kind: "pencil" }} label={b.label} start={b.text} />
        ) : (
          <span className="vsheet__pencil-empty" />
        )}
      </div>
    );
  }
  if (b.style === "circles" || b.style === "boxes") {
    const max = b.style === "circles" ? b.circles : b.squares;
    return (
      <>
        {value}
        {b.field && max > 0 && (
          <ui.Field
            field={{ id: b.field, kind: "ticks", max }}
            label={b.label}
            shape={b.style === "circles" ? "circle" : "square"}
          />
        )}
      </>
    );
  }
  return value;
}

function Scores({ s, i, ui }: Props<"scoreColumn">) {
  return (
    <div className="vsheet__scores">
      {s.scores.map((sc, j) => (
        <div key={`${sc.valueId}-${j}`} className="vsheet__score">
          {/* One line for both where they fit; else the derived label above, as in the PDF. */}
          <div className="vsheet__score-head">
            <p className="vsheet__score-label">
              <ui.Text path={at(i, "scores", j, "label")} value={sc.label} label={sc.label} />
            </p>
            {sc.derived !== null && (
              <p className="vsheet__score-derived-label">
                <ui.Text
                  path={at(i, "scores", j, "derivedLabel")}
                  value={sc.derivedLabel}
                  label={sc.derivedLabel}
                />
              </p>
            )}
          </div>
          <p className="vsheet__score-value">
            <ui.Text path={at(i, "scores", j, "value")} value={sc.value} label={sc.label} />
          </p>
          {sc.extra && (
            <p className="vsheet__score-extra">
              <span className="vsheet__score-extra-label">
                <ui.Text
                  path={at(i, "scores", j, "extra", "label")}
                  value={sc.extra.label}
                  label={sc.extra.label}
                />
              </span>
              <span className="vsheet__score-extra-value">
                <ui.Text
                  path={at(i, "scores", j, "extra", "value")}
                  value={sc.extra.value}
                  label={sc.extra.label}
                />
              </span>
            </p>
          )}
          {sc.derived !== null && (
            <p className="vsheet__score-derived">
              <ui.Text path={at(i, "scores", j, "derived")} value={sc.derived} label={sc.derivedLabel} />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CheckList({ s, i, ui }: Props<"checkList">) {
  return (
    <ul className="vsheet__checks">
      {s.items.map((item, j) => (
        <li key={`${item.id}-${j}`} className="vsheet__check">
          <span
            className={`vsheet__dot${item.marked ? " vsheet__dot--on" : ""}${item.strong ? " vsheet__dot--strong" : ""}`}
            aria-hidden="true"
          />
          <span className="vsheet__check-name">
            <ui.Text path={at(i, "items", j, "name")} value={item.name} label={item.name} />
          </span>
          {item.total.parts !== "" && (
            <span className="vsheet__check-parts">
              <ui.Text
                path={at(i, "items", j, "total", "parts")}
                value={item.total.parts}
                label={item.name}
              />
            </span>
          )}
          {item.note !== "" && (
            <span className="vsheet__check-note">
              <ui.Text path={at(i, "items", j, "note")} value={item.note} label={item.name} />
            </span>
          )}
          <span className="vsheet__check-total">
            {item.field && item.total.text === "" ? (
              <ui.Field field={{ id: item.field, kind: "pencil" }} label={item.name} />
            ) : (
              <ui.Text path={at(i, "items", j, "total", "text")} value={item.total.text} label={item.name} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatTable({ s, i, ui, rowName }: Props<"statTable"> & { rowName: string }) {
  return (
    <div className="vsheet__table-wrap">
      <table className="vsheet__table">
        <thead>
          <tr>
            <td />
            {s.columns.map((c, k) => (
              <th key={k} scope="col">
                <ui.Text path={at(i, "columns", k)} value={c} label={s.title} />
              </th>
            ))}
            <td />
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r, j) => (
            <tr key={j}>
              <th scope="row">
                <ui.Text path={at(i, "rows", j, "name")} value={r.name} label={rowName} />
              </th>
              {r.cells.map((c, k) => (
                <td
                  key={k}
                  data-col={s.columns[k] ?? ""}
                  className={s.wrap?.[k] ? "vsheet__wrap" : undefined}
                >
                  <ui.Text path={at(i, "rows", j, "cells", k)} value={c} label={s.columns[k] ?? s.title} />
                </td>
              ))}
              <td className="vsheet__row-tools">
                <ui.RemoveRow section={i} row={j} label={s.title} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ui.AddRow section={i} label={s.title} />
    </div>
  );
}

function FeatureTable({ s, i, ui, rowName }: Props<"featureTable"> & { rowName: string }) {
  let group: string | null = null;
  return (
    <div className="vsheet__features">
      {s.lead.map((p, j) => (
        <p key={j} className="vsheet__lead">
          <ui.Text path={at(i, "lead", j)} value={p} label={s.title} multiline />
        </p>
      ))}
      {s.rows.map((r, j) => {
        const head = r.group !== null && r.group.key !== group ? r.group : null;
        // The player's own rows after the package's groups: under no group's heading.
        const own = r.group === null && group !== null;
        group = r.group?.key ?? null;
        return (
          <div
            key={`${r.id}-${j}`}
            className={`vsheet__feature-wrap${own ? " vsheet__feature-wrap--own" : ""}`}
          >
            {head && (
              <p className="vsheet__group">
                <span>{head.title}</span>
                {head.hint !== "" && <span className="vsheet__group-hint"> · {head.hint}</span>}
              </p>
            )}
            <Feature r={r} path={at(i, "rows", j)} ui={ui} rowName={rowName} label={r.name || s.title} />
            <ui.RemoveRow section={i} row={j} label={s.title} />
          </div>
        );
      })}
      <ui.AddRow section={i} label={s.title} />
      {s.legend.length > 0 && <p className="vsheet__hint">{s.legend.join(" · ")}</p>}
    </div>
  );
}

/** `label` names the row's other places: its name, or the section's title while it has none. */
function Feature({
  r,
  path,
  ui,
  rowName,
  label,
}: {
  r: FeatureRow;
  path: (string | number)[];
  ui: SheetUi;
  rowName: string;
  label: string;
}) {
  return (
    <div className="vsheet__feature">
      <div className="vsheet__feature-name">
        <span className="vsheet__feature-title">
          <ui.Text path={[...path, "name"]} value={r.name} label={rowName} />
        </span>
        {r.marks !== "" && <span className="vsheet__marks">{r.marks}</span>}
        {r.note !== undefined && r.note !== "" && (
          <span className="vsheet__feature-note">
            <ui.Text path={[...path, "note"]} value={r.note} label={label} />
          </span>
        )}
      </div>
      <div className="vsheet__feature-text">
        <ui.Text path={[...path, "text"]} value={r.text} label={label} multiline />
      </div>
      {r.uses !== null && (
        <div className="vsheet__uses">
          {"text" in r.uses ? (
            <span className="vsheet__uses-text">{r.uses.text}</span>
          ) : "boxes" in r.uses ? (
            r.usesField && (
              <ui.Field
                field={{ id: r.usesField, kind: "ticks", max: r.uses.boxes }}
                label={label}
                shape="square"
              />
            )
          ) : (
            <>
              <span className="vsheet__uses-count">{r.uses.count}</span>
              {r.usesField && <ui.Field field={{ id: r.usesField, kind: "pencil" }} label={label} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** An entry of a list, with the package's line about it small under it (format 0.22); the line is not written on. */
function ListEntry({ s, i, j, ui }: Props<"list"> & { j: number }) {
  const entry = <ui.Text path={at(i, "items", j)} value={s.items[j]!} label={s.title} />;
  const detail = s.details?.[j] ?? "";
  if (detail === "") return entry;
  return (
    <div className="vsheet__list-entry">
      {entry}
      <span className="vsheet__list-detail">{detail}</span>
    </div>
  );
}

function List({ s, i, ui }: Props<"list">) {
  return (
    <div className="vsheet__list">
      <ul>
        {s.items.map((_, j) => (
          <li key={j}>
            <ListEntry s={s} i={i} j={j} ui={ui} />
            <ui.RemoveRow section={i} row={j} label={s.title} />
          </li>
        ))}
      </ul>
      {/* The lines right under the entries, as on paper; the button for a new entry after them. */}
      {s.blankLines > 0 &&
        (s.field ? (
          <ui.Field field={{ id: s.field, kind: "text" }} label={s.title} lines={s.blankLines} />
        ) : (
          <Lines n={s.blankLines} />
        ))}
      <ui.AddRow section={i} label={s.title} />
    </div>
  );
}
