/**
 * The design "classic" (Klassisch) on screen: the layout of the well-known
 * three-column sheet, titles and numbers only, no hints and no help box.
 * The sections come in the design's order (`classicPlan`), the same plan
 * the PDF follows: on a phone one card under the other in that order, from
 * desk width (900 px) on an A4 page with the columns of page 1 (scores,
 * checks, the boxes at the table and the tables), the band under them and
 * two columns after. Styles in `screen.css`; measures from the design's
 * geometry (`index.ts`), shared with the PDF.
 */
import type { CSSProperties, ReactNode } from "react";
import { MESSAGES } from "../../src/messages.ts";
import type { FeatureRow, SheetSection, StatBox } from "../../src/model.ts";
import { PageFooter, PageHead } from "../page-parts.tsx";
import type { SheetScreenProps, SheetUi } from "../types.ts";
import { CLASSIC_GEOMETRY as G, classicPlan, clusterRows, firstColumns } from "./index.ts";

const COLUMNS = firstColumns(G);

/** The geometry as CSS variables, so the style sheet has no measure of its own. */
const pageStyle = {
  "--cs-page-w": `${G.page.width}mm`,
  "--cs-page-h": `${G.page.height}mm`,
  "--cs-margin": `${G.margin}mm`,
  "--cs-a": `${COLUMNS.a.w}mm`,
  "--cs-b": `${COLUMNS.b.w}mm`,
  "--cs-c": `${COLUMNS.c.w}mm`,
  "--cs-gap": `${G.first.gap}mm`,
  "--cs-column-gap": `${G.columnGap}mm`,
  "--cs-row-gap": `${G.rowGap}mm`,
  "--cs-name-w": `${G.first.nameWidth}mm`,
  "--cs-score-h": `${G.box.score}mm`,
  "--cs-oval-w": `${G.box.oval.width}mm`,
  "--cs-oval-h": `${G.box.oval.height}mm`,
  "--cs-number-h": `${G.box.number}mm`,
  "--cs-pencil-h": `${G.box.pencil}mm`,
  "--cs-marks-h": `${G.box.marks}mm`,
  "--cs-box-gap": `${G.box.gap}mm`,
  "--cs-side-w": `${G.box.side.width}mm`,
  "--cs-side-h": `${G.box.side.height}mm`,
  "--cs-row-box-w": `${G.box.rowBox.width}mm`,
  "--cs-row-box-h": `${G.box.rowBox.height}mm`,
  "--cs-radius": `${G.box.radius}mm`,
  "--cs-row": `${G.box.row}mm`,
  "--cs-list-line": `${G.box.listLine}mm`,
  "--cs-line": `${G.writingLine}mm`,
  "--cs-dot": `${G.box.dot}mm`,
  "--cs-square": `${G.box.square}mm`,
  ...Object.fromEntries(Object.entries({ ...G.type, ...G.more }).map(([k, v]) => [`--cs-${k}`, `${v}pt`])),
} as CSSProperties;

type Props<K extends SheetSection["kind"]> = {
  s: Extract<SheetSection, { kind: K }>;
  i: number;
  ui: SheetUi;
};

const at = (i: number, ...rest: (string | number)[]) => ["sections", i, ...rest];

export function ClassicSheet({ model, ui }: SheetScreenProps) {
  const m = MESSAGES[model.language];
  const plan = classicPlan(model.sections);
  const words = { playedBy: m?.playedBy ?? "", pencil: m?.pencil ?? "", rowName: m?.rowName ?? "" };
  const sections = (part: keyof typeof plan.parts, order = plan.parts[part]) =>
    order.map((i) => (
      <Section key={`${model.sections[i]!.id}-${i}`} s={model.sections[i]!} i={i} ui={ui} words={words} />
    ));
  const scoresAt = plan.parts.scores[0];
  const scores = scoresAt === undefined ? undefined : model.sections[scoresAt];
  // The pages of the PDF: page 1, then what comes after it in two columns, then the apart part.
  const more = [...(plan.apartPage ? [] : plan.parts.apart), ...plan.parts.later];
  const total = 1 + (more.length > 0 ? 1 : 0) + (plan.apartPage ? 1 : 0);
  // On their own page the box rows come first, across the page, as in the PDF.
  const boxRowsFirst = [...plan.parts.apart].sort(
    (x, y) =>
      Number(model.sections[y]!.kind === "statBoxes") - Number(model.sections[x]!.kind === "statBoxes"),
  );
  const footer = (page: number) => <PageFooter model={model} page={page} total={total} prefix="csheet" />;
  return (
    <article className="csheet" lang={model.language} style={pageStyle}>
      <div className="csheet__page">
        <div className="csheet__head">{sections("header")}</div>
        <div className="csheet__cluster">{sections("cluster")}</div>
        <div className="csheet__a">{sections("scores")}</div>
        <div className="csheet__b">
          {scores?.kind === "scoreColumn" && <Extras s={scores} i={scoresAt!} ui={ui} />}
          {sections("checks")}
          {sections("side")}
        </div>
        <div className="csheet__c">{sections("right")}</div>
        <div className="csheet__band">{sections("band")}</div>
        {footer(1)}
      </div>
      {more.length > 0 && (
        <div className="csheet__page csheet__page--more">
          <PageHead model={model} prefix="csheet" />
          <div className="csheet__more">
            {!plan.apartPage && sections("apart")}
            {sections("later")}
          </div>
          {footer(2)}
        </div>
      )}
      {plan.apartPage && (
        <div className="csheet__page csheet__page--apart">
          <PageHead model={model} prefix="csheet" />
          <div className="csheet__apart">{sections("apart", boxRowsFirst)}</div>
          {footer(total)}
        </div>
      )}
    </article>
  );
}

interface Words {
  playedBy: string;
  pencil: string;
  rowName: string;
}

function Section({ s, i, ui, words }: { s: SheetSection; i: number; ui: SheetUi; words: Words }) {
  return (
    <section
      className={`csheet__section csheet__section--${s.kind}`}
      data-section={s.id}
      aria-label={s.kind === "header" ? s.name : s.title || undefined}
    >
      {s.kind !== "header" && s.title !== "" && (
        <h2 className="csheet__title">
          <ui.Text path={at(i, "title")} value={s.title} label={s.title} />
        </h2>
      )}
      <Body s={s} i={i} ui={ui} words={words} />
    </section>
  );
}

function Body({ s, i, ui, words }: { s: SheetSection; i: number; ui: SheetUi; words: Words }): ReactNode {
  switch (s.kind) {
    case "header":
      return <Header s={s} i={i} ui={ui} playedBy={words.playedBy} />;
    case "statBoxes":
      return <Boxes s={s} i={i} ui={ui} pencil={words.pencil} />;
    case "scoreColumn":
      return <Scores s={s} i={i} ui={ui} />;
    case "checkList":
      return <CheckList s={s} i={i} ui={ui} />;
    case "statTable":
      return <StatTable s={s} i={i} ui={ui} rowName={words.rowName} />;
    case "featureTable":
      return <FeatureTable s={s} i={i} ui={ui} rowName={words.rowName} />;
    case "list":
      return <List s={s} i={i} ui={ui} />;
    case "answers":
      return (
        <dl className="csheet__answers">
          {s.rows.map((r, j) => (
            <div key={j} className="csheet__answer">
              <dt className="csheet__label">
                <ui.Text path={at(i, "rows", j, "label")} value={r.label} label={r.label} />
              </dt>
              <dd className={r.text === "" ? "csheet__open" : undefined}>
                <ui.Text path={at(i, "rows", j, "text")} value={r.text} label={r.label} multiline />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "notes":
      return s.field ? (
        <ui.Field field={{ id: s.field, kind: "text" }} label={s.title} lines={s.lines} />
      ) : (
        <Lines n={s.lines} />
      );
    case "helpBox":
      return null;
  }
}

function Lines({ n }: { n: number }) {
  return <div className="csheet__lines" style={{ "--cs-lines": String(n) } as CSSProperties} />;
}

function Header({ s, i, ui, playedBy }: Props<"header"> & { playedBy: string }) {
  return (
    <div className="csheet__header">
      <p className="csheet__package">{s.packageName}</p>
      <div className="csheet__who">
        <h1 className="csheet__name">
          <ui.Text path={at(i, "name")} value={s.name} label={s.name} />
        </h1>
        <p className="csheet__summary">
          <ui.Text path={at(i, "summary")} value={s.summary} label={s.name} />
        </p>
      </div>
      <dl className="csheet__fields">
        {s.fields.map((f, j) => (
          <div key={j} className="csheet__cell">
            <dt className="csheet__label">
              <ui.Text path={at(i, "fields", j, "label")} value={f.label} label={f.label} />
            </dt>
            <dd>
              <ui.Text path={at(i, "fields", j, "text")} value={f.text} label={f.label} />
            </dd>
          </div>
        ))}
        {s.playedByField && (
          <div className="csheet__cell">
            <dt className="csheet__label">{playedBy}</dt>
            <dd>
              <ui.Field field={{ id: s.playedByField, kind: "text" }} label={playedBy} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Boxes in the rows of the design: numbers side by side, a wide box per pencil value, then all to tick. */
function Boxes({ s, i, ui, pencil }: Props<"statBoxes"> & { pencil: string }) {
  const indexed = s.boxes.map((b, j) => ({ ...b, j }));
  return (
    <div className="csheet__boxes">
      {clusterRows(indexed).map((row, r) => (
        <div key={r} className={`csheet__box-row csheet__box-row--${row.style}`}>
          {row.boxes.map((b) => (
            <Box key={`${b.valueId}-${b.j}`} b={b} path={at(i, "boxes", b.j)} ui={ui} pencil={pencil} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Box({
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
  const label = (
    <p className="csheet__box-label">
      <ui.Text path={[...path, "label"]} value={b.label} label={b.label} />
    </p>
  );
  if (b.style === "pencil") {
    return (
      <div className="csheet__box csheet__box--pencil">
        {b.hint !== "" && (
          <p className="csheet__start">
            <ui.Text path={[...path, "hint"]} value={b.hint} label={b.label} />
          </p>
        )}
        <span className="csheet__pencil-what">{pencil}</span>
        {b.field ? (
          <ui.Field field={{ id: b.field, kind: "pencil" }} label={b.label} />
        ) : (
          <span className="csheet__pencil-empty" />
        )}
        {label}
      </div>
    );
  }
  const max = b.style === "circles" ? b.circles : b.style === "boxes" ? b.squares : 0;
  return (
    <div className={`csheet__box csheet__box--${b.style}`} style={{ "--cs-marks": max } as CSSProperties}>
      {b.text !== "" && b.style !== "circles" && (
        <p className="csheet__box-value">
          <ui.Text path={[...path, "text"]} value={b.text} label={b.label} />
        </p>
      )}
      {b.field && max > 0 && (
        <ui.Field
          field={{ id: b.field, kind: "ticks", max }}
          label={b.label}
          shape={b.style === "circles" ? "circle" : "square"}
        />
      )}
      {label}
    </div>
  );
}

function Scores({ s, i, ui }: Props<"scoreColumn">) {
  return (
    <div className="csheet__scores">
      {s.scores.map((sc, j) => (
        <div key={`${sc.valueId}-${j}`} className="csheet__score">
          <p className="csheet__score-label">
            <ui.Text path={at(i, "scores", j, "label")} value={sc.label} label={sc.label} />
          </p>
          {sc.derived !== null ? (
            <>
              <p className="csheet__score-big">
                <ui.Text path={at(i, "scores", j, "derived")} value={sc.derived} label={sc.derivedLabel} />
              </p>
              <p className="csheet__score-oval">
                <ui.Text path={at(i, "scores", j, "value")} value={sc.value} label={sc.label} />
              </p>
            </>
          ) : (
            <p className="csheet__score-big">
              <ui.Text path={at(i, "scores", j, "value")} value={sc.value} label={sc.label} />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Top of column B: the further number of every score that has one. No circle: the package does
 * not say which of them are trained, and an empty circle would say "not trained" for all.
 */
function Extras({ s, i, ui }: Props<"scoreColumn">) {
  const rows = s.scores.flatMap((sc, j) => (sc.extra ? [{ sc, j, extra: sc.extra }] : []));
  const first = rows[0];
  if (!first) return null;
  return (
    <div className="csheet__extras" data-part="extras">
      <p className="csheet__title csheet__title--center">
        <ui.Text
          path={at(i, "scores", first.j, "extra", "label")}
          value={first.extra.label}
          label={first.extra.label}
        />
      </p>
      <ul className="csheet__checks">
        {rows.map(({ sc, j, extra }) => (
          <li key={`${sc.valueId}-${j}`} className="csheet__check csheet__check--plain">
            <span className="csheet__check-total">
              <ui.Text path={at(i, "scores", j, "extra", "value")} value={extra.value} label={extra.label} />
            </span>
            <span className="csheet__check-name">{sc.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckList({ s, i, ui }: Props<"checkList">) {
  return (
    <>
      <ul className="csheet__checks">
        {s.items.map((item, j) => (
          <li key={`${item.id}-${j}`} className="csheet__check">
            <span
              className={`csheet__dot${item.marked ? " csheet__dot--on" : ""}${item.strong ? " csheet__dot--strong" : ""}`}
              aria-hidden="true"
            />
            <span className="csheet__check-total">
              {item.field && item.total.text === "" ? (
                <ui.Field field={{ id: item.field, kind: "pencil" }} label={item.name} />
              ) : (
                <ui.Text
                  path={at(i, "items", j, "total", "text")}
                  value={item.total.text}
                  label={item.name}
                />
              )}
            </span>
            <span className="csheet__check-name">
              <ui.Text path={at(i, "items", j, "name")} value={item.name} label={item.name} />
            </span>
            {item.note !== "" && (
              <span className="csheet__check-note">
                <ui.Text path={at(i, "items", j, "note")} value={item.note} label={item.name} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {s.legend.length > 0 && <p className="csheet__legend">{s.legend.join(" ")}</p>}
    </>
  );
}

/** A cell up to this long keeps one line, as a number does on paper; a longer one wraps. */
const SHORT_CELL = 12;

function StatTable({ s, i, ui, rowName }: Props<"statTable"> & { rowName: string }) {
  return (
    <div className="csheet__table-wrap">
      <table className="csheet__table">
        <thead>
          <tr>
            <td />
            {s.columns.map((c, k) => (
              <th key={k} scope="col">
                <ui.Text path={at(i, "columns", k)} value={c} label={s.title} />
              </th>
            ))}
            <td className="csheet__row-tools" />
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
                  className={
                    s.wrap?.[k] ? "csheet__wrap" : c.length <= SHORT_CELL ? "csheet__short" : undefined
                  }
                >
                  <ui.Text path={at(i, "rows", j, "cells", k)} value={c} label={s.columns[k] ?? s.title} />
                </td>
              ))}
              <td className="csheet__row-tools">
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
    <div className="csheet__features">
      {s.lead.map((p, j) => (
        <p key={j} className="csheet__lead">
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
            className={`csheet__feature-wrap${own ? " csheet__feature-wrap--own" : ""}`}
          >
            {head && <p className="csheet__group">{head.title}</p>}
            <Feature r={r} path={at(i, "rows", j)} ui={ui} rowName={rowName} label={r.name || s.title} />
            <ui.RemoveRow section={i} row={j} label={s.title} />
          </div>
        );
      })}
      <ui.AddRow section={i} label={s.title} />
      {s.legend.length > 0 && (
        <div className="csheet__legend">
          {s.legend.map((l, j) => (
            <p key={j}>{l}</p>
          ))}
        </div>
      )}
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
    <div className="csheet__feature">
      <div className="csheet__feature-name">
        <span className="csheet__feature-title">
          <ui.Text path={[...path, "name"]} value={r.name} label={rowName} />
        </span>
        {r.note !== undefined && r.note !== "" && (
          <span className="csheet__feature-note">
            <ui.Text path={[...path, "note"]} value={r.note} label={label} />
          </span>
        )}
      </div>
      {r.marks !== "" && <span className="csheet__marks">{r.marks}</span>}
      <div className="csheet__feature-text">
        <ui.Text path={[...path, "text"]} value={r.text} label={label} multiline />
      </div>
      {r.uses !== null && (
        <div className="csheet__uses">
          {"text" in r.uses ? (
            <span>{r.uses.text}</span>
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
              <span>{r.uses.count}</span>
              {r.usesField && <ui.Field field={{ id: r.usesField, kind: "pencil" }} label={label} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function List({ s, i, ui }: Props<"list">) {
  return (
    <div className="csheet__list">
      <ul>
        {s.items.map((item, j) => (
          <li key={j}>
            <ui.Text path={at(i, "items", j)} value={item} label={s.title} />
            <ui.RemoveRow section={i} row={j} label={s.title} />
          </li>
        ))}
      </ul>
      <ui.AddRow section={i} label={s.title} />
      {s.blankLines > 0 &&
        (s.field ? (
          <ui.Field field={{ id: s.field, kind: "text" }} label={s.title} lines={s.blankLines} />
        ) : (
          <Lines n={s.blankLines} />
        ))}
    </div>
  );
}
