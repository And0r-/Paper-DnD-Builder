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
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { MESSAGES } from "../../src/messages.ts";
import type { FeatureRow, SheetModel, SheetSection, StatBox } from "../../src/model.ts";
import { PageFooter, PageHead } from "../page-parts.tsx";
import type { PrintPlaces, SheetScreenProps, SheetUi } from "../types.ts";
import { CLASSIC_GEOMETRY as G, classicPlan, clusterRows, firstColumns, type ClassicPlan } from "./index.ts";

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

export function ClassicSheet({ model, ui, places }: SheetScreenProps) {
  const m = MESSAGES[model.language];
  const plan = classicPlan(model.sections);
  const words = {
    playedBy: m?.playedBy ?? "",
    pencil: m?.pencil ?? "",
    rowName: m?.rowName ?? "",
    continued: m?.continued ?? "",
  };
  const box = useRef<HTMLElement>(null);
  const measured = useFlow(box, model, plan);
  const flow = { ...measured, ...fromPrint(plan, places, model) };
  const breaks = new Set(flow.breaks);
  const section = (i: number, part?: Partial<Part>) => (
    <Section
      key={`${model.sections[i]!.id}-${i}${part?.cont ? "-cont" : ""}`}
      s={model.sections[i]!}
      i={i}
      ui={ui}
      words={words}
      part={{ from: 0, to: Infinity, cont: false, lines: flow.lines[i], ...part, breaks }}
    />
  );
  /** A part of page 1 up to where it spills: the rest goes on at the top of page 2. */
  const kept = (list: number[], spill: Spill | null) =>
    list.flatMap((i) => {
      if (!spill || list.indexOf(i) < list.indexOf(spill.section)) return [section(i)];
      if (i === spill.section && spill.row > 0) return [section(i, { to: spill.row })];
      return [];
    });
  const spilled = (list: number[], spill: Spill | null) =>
    !spill
      ? []
      : list
          .slice(list.indexOf(spill.section))
          .map((i) =>
            i === spill.section && spill.row > 0 ? section(i, { from: spill.row, cont: true }) : section(i),
          );
  const sections = (part: keyof typeof plan.parts) => plan.parts[part].map((i) => section(i));
  const scoresAt = plan.parts.scores[0];
  const scores = scoresAt === undefined ? undefined : model.sections[scoresAt];
  // The pages of the PDF: page 1, then what comes after it in two columns, then the apart part
  // (under page 2 when it is short and fits there, as in the PDF).
  const over = [...spilled(plan.parts.right, flow.right), ...spilled(plan.parts.band, flow.band)];
  const more = [...over, ...(plan.apartPage ? [] : sections("apart")), ...sections("later")];
  const under = plan.apartPage && more.length > 0 && flow.under;
  const apartPage = plan.apartPage && !under;
  const total = 1 + (more.length > 0 ? 1 : 0) + (apartPage ? 1 : 0);
  const footer = (page: number) => <PageFooter model={model} page={page} total={total} prefix="csheet" />;
  const apart = (
    <div className={`csheet__apart${flow.apartOne ? " csheet__apart--one" : ""}`}>{sections("apart")}</div>
  );
  return (
    <article ref={box} className="csheet" lang={model.language} style={pageStyle}>
      <span className="csheet__mm" aria-hidden="true" />
      <div className="csheet__page">
        <div className="csheet__head">{sections("header")}</div>
        <div className="csheet__cluster">{sections("cluster")}</div>
        <div className="csheet__a">{sections("scores")}</div>
        <div className="csheet__b">
          {scores?.kind === "scoreColumn" && <Extras s={scores} i={scoresAt!} ui={ui} />}
          {sections("checks")}
          {sections("side")}
        </div>
        <div className="csheet__c">{kept(plan.parts.right, flow.right)}</div>
        <div className="csheet__band">{kept(plan.parts.band, flow.band)}</div>
        {footer(1)}
      </div>
      {more.length > 0 && (
        <div className="csheet__page csheet__page--more">
          <PageHead model={model} prefix="csheet" />
          <div className="csheet__more">{more}</div>
          {under && apart}
          {footer(2)}
        </div>
      )}
      {apartPage && (
        <div className="csheet__page csheet__page--apart">
          <PageHead model={model} prefix="csheet" />
          {apart}
          {footer(total)}
        </div>
      )}
    </article>
  );
}

/** Where a part of page 1 goes on on page 2: from this section's row on (0: the whole section). */
interface Spill {
  section: number;
  row: number;
}

/** The rows of a section shown in one place, and what goes with them there. */
interface Part {
  from: number;
  to: number;
  /** The section goes on here: its title marked as continued, no lead. */
  cont: boolean;
  /** Lines to write on, if fewer than the section's (page 1 is full). */
  lines?: number | undefined;
  /** Rows ("section:row") that start a column of their own, under the title marked as continued. */
  breaks?: Set<string>;
}

interface Flow {
  right: Spill | null;
  band: Spill | null;
  /** Lines to write on per section index, where fewer fit on page 1. */
  lines: Record<number, number>;
  /** Rows that start the second column of a page, under their section's title marked as continued. */
  breaks: string[];
  /** The apart part under page 2 instead of on a page of its own. */
  under: boolean;
  /** The rest of the apart part (after its box rows) is short: one column. */
  apartOne: boolean;
}

const NO_FLOW: Flow = { right: null, band: null, lines: {}, breaks: [], under: false, apartOne: false };
const DESK = "(min-width: 900px)";
/** As in the PDF: an apart part under 40 % of a page goes under the page before; a rest up to 90 mm is one column. */
const SHORT_APART = 0.4;
const SHORT_REST = 90;

/**
 * From desk width on, the pages break as the PDF's do, measured on the
 * screen: what does not fit on page 1 (column C, the band under A and B)
 * goes on at the top of page 2 under its title marked as continued; a
 * section going on in a page's second column gets that title there too;
 * a short apart part goes under page 2. One step per frame until nothing
 * moves; a change to the model starts over. On a phone, nothing of this.
 */
function useFlow(box: RefObject<HTMLElement | null>, model: SheetModel, plan: ClassicPlan): Flow {
  const [state, setState] = useState<{ model: SheetModel; flow: Flow }>({ model, flow: NO_FLOW });
  const flow = state.model === model ? state.flow : { ...state.flow, breaks: [] };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const desk = window.matchMedia(DESK);
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = desk.matches ? nextFlow(el, model, plan, flow) : NO_FLOW;
        if (state.model !== model || JSON.stringify(next) !== JSON.stringify(flow))
          setState({ model, flow: next });
      });
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    desk.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      desk.removeEventListener("change", measure);
    };
  });
  return flow;
}

/**
 * What the PDF decided for the apart part, once its places are known: under
 * page 2 (it starts on the page the last section before it is on) and its
 * rest in one column. The screen's sections are taller than paper's, so
 * measuring would decide otherwise near the edge.
 */
function fromPrint(
  plan: ClassicPlan,
  places: PrintPlaces | null | undefined,
  model: SheetModel,
): Partial<Flow> {
  if (!places || places.sections.length !== model.sections.length || !plan.apartPage) return {};
  const apart = plan.parts.apart.map((i) => places.sections[i]).filter((p) => p !== null && p !== undefined);
  const before = [...plan.parts.right, ...plan.parts.band, ...plan.parts.later]
    .map((i) => places.sections[i]?.page ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const rest = plan.parts.apart
    .filter((i) => model.sections[i]!.kind !== "statBoxes")
    .map((i) => places.sections[i])
    .filter((p) => p !== null && p !== undefined);
  if (apart.length === 0) return {};
  return {
    under: apart[0]!.page === before && before > 0,
    apartOne: rest.every((p) => p.cols.every((c) => c === 0)),
  };
}

const rect = (e: Element) => e.getBoundingClientRect();

/** One step of the flow towards the pages of the PDF, from the screen as drawn now. */
function nextFlow(el: HTMLElement, model: SheetModel, plan: ClassicPlan, now: Flow): Flow {
  const mm = rect(el.querySelector(".csheet__mm") ?? el).height / 100;
  const [first, second] = [...el.querySelectorAll<HTMLElement>(":scope > .csheet__page")];
  const foot = first?.querySelector(":scope > .csheet__footer");
  if (!first || !foot || mm <= 0) return now;
  // The foot of page 1's content on A4, whatever the page grew to: above the footer and the gap before it.
  const gap = parseFloat(getComputedStyle(first).rowGap) || 0;
  const limit = rect(first).top + (G.page.height - G.margin) * mm - rect(foot).height - gap;
  const next: Flow = { ...now, lines: { ...now.lines } };

  // Page 1: column C and the band end above the footer.
  const units = (container: Element | null) =>
    container
      ? [...container.querySelectorAll<HTMLElement>(":scope > [data-index]")].flatMap((sec) => {
          const rows = [...sec.querySelectorAll<HTMLElement>("[data-row], [data-lines]")];
          return rows.length > 0 ? rows.map((r) => ({ sec, r })) : [{ sec, r: sec }];
        })
      : [];
  const later = (list: number[], spill: Spill) =>
    second
      ? units(second.querySelector(".csheet__more")).filter(({ sec, r }) => {
          const i = Number(sec.dataset["index"]);
          return list.includes(i) && list.indexOf(i) >= list.indexOf(spill.section) && !r.dataset["lines"];
        })
      : [];
  for (const [key, list] of [
    ["right", plan.parts.right],
    ["band", plan.parts.band],
  ] as const) {
    const spill = now[key];
    const container = first.querySelector(`.csheet__${key === "right" ? "c" : "band"}`);
    const here = units(container);
    // Where its content ends, with what follows the last row (the button for a new row, a legend).
    const contentEnd = Math.max(0, ...[...(container?.children ?? [])].map((c) => rect(c).bottom));
    const tail = [...here].reverse().find(({ r }) => r.dataset["lines"] === undefined);
    const out =
      here.find(({ r }) => rect(r).bottom > limit + 0.5) ?? (contentEnd > limit + 0.5 ? tail : undefined);
    if (out) {
      const i = Number(out.sec.dataset["index"]);
      if (out.r.dataset["lines"] !== undefined) {
        // Empty lines never go on elsewhere: fewer of them.
        const lines = out.r.querySelector<HTMLElement>("textarea, .csheet__lines") ?? out.r;
        const n = Number(out.r.dataset["lines"]);
        const pitch = rect(lines).height / Math.max(1, n);
        next.lines[i] = Math.max(0, Math.floor((limit - rect(lines).top) / pitch));
        continue;
      }
      const row = out.r.dataset["row"] === undefined ? 0 : Number(out.r.dataset["row"]);
      const firstRow = here.find((u) => u.sec === out.sec && u.r.dataset["row"] !== undefined);
      next[key] = { section: i, row: out.r === firstRow?.r ? 0 : row };
      continue;
    }
    // Room left: lines taken away come back one by one, then what went on to page 2.
    const end = (c: Element | null) => Math.max(c ? rect(c).top : 0, contentEnd);
    const fewer = list.find((i) => next.lines[i] !== undefined);
    if (fewer !== undefined) {
      const n = next.lines[fewer]!;
      const pitch = Math.max(G.box.listLine * mm, 25);
      if (limit - end(first.querySelector(`.csheet__${key === "right" ? "c" : "band"}`)) >= pitch + 1) {
        const sec = model.sections[fewer]!;
        const blank = sec.kind === "list" ? sec.blankLines : 0;
        if (n + 1 >= blank) delete next.lines[fewer];
        else next.lines[fewer] = n + 1;
      }
      continue;
    }
    if (!spill) continue;
    // The next unit that went on comes back if it fits.
    const bottom = Math.max(container ? rect(container).top : 0, contentEnd);
    const back = later(list, spill)[0];
    if (back) {
      const i = Number(back.sec.dataset["index"]);
      const rows = units(second!.querySelector(".csheet__more")).filter(
        (u) => u.sec === back.sec && !u.r.dataset["lines"],
      );
      const row = back.r.dataset["row"] === undefined ? Infinity : Number(back.r.dataset["row"]) + 1;
      const end = rows.length === 0 || row > Number(rows.at(-1)!.r.dataset["row"] ?? -1);
      // What comes back with it: the title above a section's first row, the button and legend after its last.
      const head = back.r !== back.sec && back.r === rows[0]?.r ? rect(back.r).top - rect(back.sec).top : 0;
      const tail = back.r !== back.sec && end ? rect(back.sec).bottom - rect(back.r).bottom : 0;
      // A section that comes back whole starts after the gap below the one before it.
      const between =
        head > 0 || back.r === back.sec
          ? (container && parseFloat(getComputedStyle(container).rowGap)) || 0
          : 0;
      if (between + head + rect(back.r).height + tail + 2 <= limit - bottom) {
        const after = list[list.indexOf(i) + 1];
        next[key] = end ? (after === undefined ? null : { section: after, row: 0 }) : { section: i, row };
      }
    }
  }

  // Columns: a section that goes on in a page's second column says so there.
  const breaks = new Set<string>();
  for (const columns of el.querySelectorAll<HTMLElement>(".csheet__more, .csheet__apart")) {
    const half = rect(columns).left + rect(columns).width / 2;
    let previous: { i: string; right: boolean } | null = null;
    for (const r of columns.querySelectorAll<HTMLElement>("[data-row]")) {
      const i = r.closest<HTMLElement>("[data-index]")?.dataset["index"] ?? "";
      const right = rect(r).left >= half - 1;
      if (previous && previous.i === i && right && !previous.right) breaks.add(`${i}:${r.dataset["row"]}`);
      previous = { i, right };
    }
  }
  next.breaks = [...breaks].sort();

  // The apart part: under page 2 when short and it fits there; its rest in one column when short.
  const apart = el.querySelector<HTMLElement>(".csheet__apart");
  if (apart && plan.apartPage) {
    const rest = [...apart.querySelectorAll<HTMLElement>(":scope > [data-index]")].filter(
      (s) => !s.classList.contains("csheet__section--statBoxes"),
    );
    if (rest.length > 0) {
      const restH =
        (Math.max(...rest.map((s) => rect(s).bottom)) - Math.min(...rest.map((s) => rect(s).top))) / mm;
      next.apartOne = now.apartOne ? restH <= SHORT_REST + 5 : 2 * restH <= SHORT_REST;
    }
    const content = (G.page.height - 2 * G.margin - G.continuationHead - G.footerHeight - G.footerGap) * mm;
    const page = second?.querySelector(":scope > .csheet__footer");
    if (now.under) {
      if (second && rect(second).height > G.page.height * mm + 1) next.under = false;
    } else if (page && second) {
      const room = rect(page).top - rect(second.querySelector(".csheet__more")!).bottom - 2 * G.rowGap * mm;
      next.under = rect(apart).height < SHORT_APART * content && rect(apart).height <= room;
    }
  }
  return next;
}

interface Words {
  playedBy: string;
  pencil: string;
  rowName: string;
  continued: string;
}

function Section({
  s,
  i,
  ui,
  words,
  part,
}: {
  s: SheetSection;
  i: number;
  ui: SheetUi;
  words: Words;
  part: Part;
}) {
  return (
    <section
      className={`csheet__section csheet__section--${s.kind}`}
      data-section={s.id}
      data-index={i}
      aria-label={s.kind === "header" ? s.name : s.title || undefined}
    >
      {s.kind !== "header" &&
        s.title !== "" &&
        (part.cont ? (
          <h2 className="csheet__title">{`${s.title} · ${words.continued}`}</h2>
        ) : (
          <h2 className="csheet__title">
            <ui.Text path={at(i, "title")} value={s.title} label={s.title} />
          </h2>
        ))}
      <Body s={s} i={i} ui={ui} words={words} part={part} />
    </section>
  );
}

/** Whether row `j` of a part is shown, is its last, and starts a column of its own. */
const shown = (part: Part, j: number) => j >= part.from && j < part.to;
const breaksAt = (part: Part, i: number, j: number) =>
  j > part.from && part.breaks?.has(`${i}:${j}`) === true;

/** Before a row that starts a page's second column: the section's title, marked as continued. */
function ColumnBreak({ title, words, as = "p" }: { title: string; words: Words; as?: "p" | "li" }) {
  const Tag = as;
  return (
    <Tag className="csheet__title csheet__colbreak" aria-hidden="true">
      {`${title} · ${words.continued}`}
    </Tag>
  );
}

function Body({
  s,
  i,
  ui,
  words,
  part,
}: {
  s: SheetSection;
  i: number;
  ui: SheetUi;
  words: Words;
  part: Part;
}): ReactNode {
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
      return <StatTable s={s} i={i} ui={ui} rowName={words.rowName} part={part} />;
    case "featureTable":
      return <FeatureTable s={s} i={i} ui={ui} rowName={words.rowName} part={part} words={words} />;
    case "list":
      return <List s={s} i={i} ui={ui} part={part} words={words} />;
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
          <ui.Field field={{ id: b.field, kind: "pencil" }} label={b.label} start={b.text} />
        ) : (
          <span className="csheet__pencil-empty" />
        )}
        {label}
      </div>
    );
  }
  const max = b.style === "circles" ? b.circles : b.style === "boxes" ? b.squares : 0;
  return (
    <div
      className={`csheet__box csheet__box--${b.style}`}
      style={{ "--cs-marks": max, "--sheet-per-row": perRow(max) } as CSSProperties}
    >
      {b.text !== "" && b.style !== "circles" && (
        <p className="csheet__box-value">
          <ui.Text path={[...path, "text"]} value={b.text} label={b.label} />
        </p>
      )}
      {(b.remarks ?? "") !== "" && (
        <p className="csheet__box-remarks">
          <ui.Text path={[...path, "remarks"]} value={b.remarks!} label={b.label} />
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

/** Marks to tick in at most two rows at a desk: up to four in one, more in two halves. */
const perRow = (n: number) => (n <= 4 ? n : Math.ceil(n / 2));

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

/**
 * A cell up to `SHORT_CELL` long keeps one line, as a number does on paper;
 * up to `ONE_LINE` it keeps one line in smaller type, as the PDF fits it
 * ("1W6 +0, stumpf oder hell"); a longer one (written by hand) wraps.
 */
const SHORT_CELL = 12;
const ONE_LINE = 30;

function cellClass(c: string, wraps: boolean | undefined): string | undefined {
  if (wraps) return "csheet__wrap";
  if (c.length <= SHORT_CELL) return "csheet__short";
  return c.length <= ONE_LINE ? "csheet__short csheet__small" : undefined;
}

function StatTable({ s, i, ui, rowName, part }: Props<"statTable"> & { rowName: string; part: Part }) {
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
          {s.rows.map((r, j) =>
            !shown(part, j) ? null : (
              <tr key={j} data-row={j}>
                <th scope="row">
                  <ui.Text path={at(i, "rows", j, "name")} value={r.name} label={rowName} />
                </th>
                {r.cells.map((c, k) => (
                  <td key={k} data-col={s.columns[k] ?? ""} className={cellClass(c, s.wrap?.[k])}>
                    <ui.Text path={at(i, "rows", j, "cells", k)} value={c} label={s.columns[k] ?? s.title} />
                  </td>
                ))}
                <td className="csheet__row-tools">
                  <ui.RemoveRow section={i} row={j} label={s.title} />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {part.to >= s.rows.length && <ui.AddRow section={i} label={s.title} />}
    </div>
  );
}

function FeatureTable({
  s,
  i,
  ui,
  rowName,
  part,
  words,
}: Props<"featureTable"> & { rowName: string; part: Part; words: Words }) {
  // A part that goes on starts under the group it is in, without its heading again.
  let group: string | null = part.from > 0 ? (s.rows[part.from - 1]?.group?.key ?? null) : null;
  const last = part.to >= s.rows.length;
  return (
    <div className="csheet__features">
      {part.from === 0 &&
        s.lead.map((p, j) => (
          <p key={j} className="csheet__lead">
            <ui.Text path={at(i, "lead", j)} value={p} label={s.title} multiline />
          </p>
        ))}
      {s.rows.map((r, j) => {
        if (!shown(part, j)) return null;
        const head = r.group !== null && r.group.key !== group ? r.group : null;
        // The player's own rows after the package's groups: under no group's heading.
        const own = r.group === null && group !== null;
        group = r.group?.key ?? null;
        return (
          <Fragment key={`${r.id}-${j}`}>
            {breaksAt(part, i, j) && <ColumnBreak title={s.title} words={words} />}
            <div className={`csheet__feature-wrap${own ? " csheet__feature-wrap--own" : ""}`} data-row={j}>
              {head && <p className="csheet__group">{head.title}</p>}
              <Feature r={r} path={at(i, "rows", j)} ui={ui} rowName={rowName} label={r.name || s.title} />
              <ui.RemoveRow section={i} row={j} label={s.title} />
            </div>
          </Fragment>
        );
      })}
      {last && <ui.AddRow section={i} label={s.title} />}
      {last && s.legend.length > 0 && (
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

/** An entry of a list, with the package's line about it small under it (format 0.22); the line is not written on. */
function ListEntry({ s, i, j, ui }: Props<"list"> & { j: number }) {
  const entry = <ui.Text path={at(i, "items", j)} value={s.items[j]!} label={s.title} />;
  const detail = s.details?.[j] ?? "";
  if (detail === "") return entry;
  return (
    <div className="csheet__list-entry">
      {entry}
      <span className="csheet__list-detail">{detail}</span>
    </div>
  );
}

function List({ s, i, ui, part, words }: Props<"list"> & { part: Part; words: Words }) {
  const last = part.to >= s.items.length;
  const lines = Math.min(s.blankLines, part.lines ?? s.blankLines);
  return (
    <div className="csheet__list">
      <ul>
        {s.items.map((_, j) =>
          !shown(part, j) ? null : (
            <Fragment key={j}>
              {breaksAt(part, i, j) && <ColumnBreak title={s.title} words={words} as="li" />}
              <li data-row={j}>
                <ListEntry s={s} i={i} j={j} ui={ui} />
                <ui.RemoveRow section={i} row={j} label={s.title} />
              </li>
            </Fragment>
          ),
        )}
      </ul>
      {/* The lines right under the entries, as on paper; the button for a new entry after them. */}
      {last && lines > 0 && (
        <div data-lines={lines}>
          {s.field ? (
            <ui.Field field={{ id: s.field, kind: "text" }} label={s.title} lines={lines} />
          ) : (
            <Lines n={lines} />
          )}
        </div>
      )}
      {last && <ui.AddRow section={i} label={s.title} />}
    </div>
  );
}
