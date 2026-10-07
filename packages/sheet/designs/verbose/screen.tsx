/**
 * The design "verbose" (Ausführlich) on screen: the sheet as on paper, with
 * the hints under every title and box and the help box, for beginners.
 * From desk width (900 px) on, an A4 page with the twelve
 * columns of the PDF; narrower, every section is a card of its own, one
 * under the other in the model's order, with room to tap. Styles in
 * `screen.css`; grid, page and type from the design's geometry (`index.ts`), shared with the PDF.
 */
import type { CSSProperties, ReactNode } from "react";
import { MESSAGES } from "../../src/messages.ts";
import type { FeatureRow, SheetSection, StatBox } from "../../src/model.ts";
import type { SheetScreenProps, SheetUi } from "../types.ts";
import { VERBOSE_GEOMETRY as G } from "./index.ts";

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

export function VerboseSheet({ model, ui }: SheetScreenProps) {
  const m = MESSAGES[model.language];
  return (
    <article className="vsheet" lang={model.language} style={pageStyle}>
      <div className="vsheet__page">
        {model.sections.map((s, i) => (
          <section
            key={`${s.id}-${i}`}
            className={`vsheet__section vsheet__section--${s.kind}`}
            style={{ "--vs-span": String(Math.min(G.columns, s.span)) } as CSSProperties}
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
        ))}
        <footer className="vsheet__footer">
          <span>{[model.name, model.levelLabel, model.unitsLine].join(" · ")}</span>
          <span>{model.createdOn}</span>
        </footer>
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
              <ui.Text path={at(i, "paragraphs", j)} value={p} label={s.title} multiline />
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
        <div key={`${b.valueId}-${j}`} className={`vsheet__box vsheet__box--${b.style}`}>
          <p className="vsheet__box-label">
            <ui.Text path={at(i, "boxes", j, "label")} value={b.label} label={b.label} />
          </p>
          <BoxBody b={b} path={at(i, "boxes", j)} ui={ui} pencil={pencil} />
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
          <ui.Field field={{ id: b.field, kind: "pencil" }} label={b.label} />
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
            {item.total.parts !== "" && (
              <span className="vsheet__check-parts">
                <ui.Text
                  path={at(i, "items", j, "total", "parts")}
                  value={item.total.parts}
                  label={item.name}
                />
              </span>
            )}
          </span>
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
                <td key={k} className={s.wrap?.[k] ? "vsheet__wrap" : undefined}>
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

function List({ s, i, ui }: Props<"list">) {
  return (
    <div className="vsheet__list">
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
