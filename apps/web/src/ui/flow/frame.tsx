"use client";
/**
 * The frame every creation step shares (flow spec 2): top bar with name
 * and save status, step list, progress, the question, and Back / Next.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type { CountedKey } from "../../i18n/index.ts";
import { useApp } from "../app-state.tsx";
import { Button, ButtonLink } from "../components/Button.tsx";
import { Callout } from "../components/Feedback.tsx";
import { Icon } from "../components/Icon.tsx";
import { RichText } from "../components/RichText.tsx";
import { AppShell } from "../components/Shell.tsx";
import { levelWord, ptext } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";
import { levelHeading, levelSpan } from "./level-runs.ts";
import { nextOpen, OVERVIEW_KEY, positionOf, progressFraction, type FlowEntry } from "./model.ts";
import {
  answeredParts,
  stepChange,
  stepsSignature,
  type GoneEntry,
  type StepChange,
} from "./step-changes.ts";

// ------------------------------------------------------------ explanation

interface ExplainApi {
  content: ReactNode;
  show(content: ReactNode): void;
}

const ExplainCtx = createContext<ExplainApi | null>(null);

/** Puts the long explanation of the focused option into the right column (large screens). */
export function useExplain(): ExplainApi["show"] {
  return useContext(ExplainCtx)?.show ?? (() => {});
}

/** True on screens wide enough for the three-column layout (design system 3). */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return wide;
}

// ------------------------------------------------------------ step changes

/** How long a step that came stays green, or one that went stays red (AND-96). */
export const MARK_MS = 2500;
/** How long a step that went takes to fold away after that. */
const LEAVE_MS = 400;

interface ShownChange extends StepChange {
  /** "show": in colour; "leave": the colour fades and the steps that went fold away. */
  phase: "show" | "leave";
}

const ChangeCtx = createContext<ShownChange | null>(null);

/**
 * The last change to the steps, while it is shown. Kept here, above the
 * step list, so the list in the menu shows it too when the menu is opened
 * in that moment, and the menu button can show it while the menu is shut.
 */
function useStepChange(entries: FlowEntry[], answers: Record<string, unknown>): ShownChange | null {
  const sig = stepsSignature(entries);
  const [seen, setSeen] = useState({ sig, entries });
  // The answers as the last shown list had them: answers can change without the steps.
  const shownAnswers = useRef(answers);
  useEffect(() => {
    shownAnswers.current = answers;
  }, [answers]);
  const [shown, setShown] = useState<{ change: StepChange; phase: "show" | "leave" } | null>(null);
  if (seen.sig !== sig) {
    // Compared during render, so the new step is green in the very frame it appears.
    setSeen({ sig, entries });
    const asked = answeredParts({ before: shownAnswers.current, after: answers });
    const change = stepChange(seen.entries, entries, asked);
    setShown(change && { change, phase: "show" });
  }
  useEffect(() => {
    if (!shown) return;
    const timer =
      shown.phase === "show"
        ? setTimeout(() => setShown({ ...shown, phase: "leave" }), MARK_MS)
        : setTimeout(() => setShown(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return useMemo(() => shown && { ...shown.change, phase: shown.phase }, [shown]);
}

/** A step that went, red and struck through for a moment, then folded away. Screen readers hear the sentence instead. */
function GoneItem({ entry, leaving }: { entry: GoneEntry; leaving: boolean }) {
  return (
    <li
      className={`steplist__item steplist__ghost${leaving ? " steplist__ghost--leaving" : ""}`}
      aria-hidden="true"
      data-gone={entry.key}
    >
      <span className="steplist__link steplist__link--gone">
        <span className="steplist__mark">
          <Icon name="minus" size={18} />
        </span>
        <span className="steplist__name">{entry.title}</span>
      </span>
    </li>
  );
}

/** The steps that went and stood after `after` (undefined: at the top) in one list. */
function goneAfter(gone: GoneEntry[], after: string | undefined, leaving: boolean): ReactNode {
  return gone
    .filter((g) => g.after === after)
    .map((g) => <GoneItem key={`gone-${g.key}`} entry={g} leaving={leaving} />);
}

// ----------------------------------------------------------------- frame

export function SaveStatus() {
  const { t } = useApp();
  const { saveState } = useDraft();
  return (
    <p className={`save-status save-status--${saveState}`} aria-live="polite">
      {t(`save.${saveState}`)}
    </p>
  );
}

function StepLink({
  entry,
  current,
  note,
  mark,
}: {
  entry: FlowEntry;
  current: string | undefined;
  /** A short line under the name ("Levels 4 to 19"). */
  note?: string | undefined;
  /** Green: the step just came (or got more). Red: a part of it just went. */
  mark?: "new" | "lost" | undefined;
}) {
  const { t } = useApp();
  const here = entry.key === current;
  const state = here ? "current" : entry.status;
  return (
    <Link
      href={entry.href}
      aria-current={here ? "step" : undefined}
      className={`steplist__link steplist__link--${state}${mark ? ` steplist__link--${mark}` : ""}`}
      data-mark={mark}
    >
      <span className="steplist__mark" aria-hidden="true">
        {state === "done" ? (
          <Icon name="check" size={18} />
        ) : state === "current" ? (
          <Icon name="dot" size={18} />
        ) : state === "needsAttention" ? (
          "!"
        ) : (
          <Icon name="circle" size={18} />
        )}
      </span>
      <span className="steplist__name">
        {entry.title}
        {note && <span className="steplist__note">{note}</span>}
      </span>
      <span className="visually-hidden">, {t(`flow.status.${state}`)}</span>
    </Link>
  );
}

/** One status for a whole step with parts: the worst of its parts. */
function sectionStatus(all: FlowEntry[]): FlowEntry["status"] {
  if (all.some((e) => e.status === "needsAttention")) return "needsAttention";
  return all.every((e) => e.status === "done") ? "done" : "open";
}

/**
 * Entries of one section with a heading wherever the level they come at
 * changes ("From level 8"), so a long run of look-alike steps (each boon
 * with its raise) reads as levels, not as a list of repeats.
 */
function LevelRuns({
  section,
  items,
  current,
  from,
}: {
  /** Key of the step these entries belong to. */
  section: string;
  items: FlowEntry[];
  current: string | undefined;
  from: number;
}) {
  const { t } = useApp();
  const { lp } = useDraft();
  const change = useContext(ChangeCtx);
  const word = levelWord(lp);
  const min = lp.pkg.flow.level.min;
  const keys = new Set(items.map((e) => e.key));
  // Parts that went from this step; one that followed an entry not listed here stands at the top.
  const gone = (change?.gone ?? [])
    .filter((g) => !g.whole && g.section === section)
    .map((g) => (g.after !== undefined && keys.has(g.after) ? g : { ...g, after: undefined }));
  const leaving = change?.phase === "leave";
  const lit = change?.phase === "show" ? change.added : undefined;
  if (items.length === 0 && gone.length === 0) return null;
  return (
    <ol className="steplist__parts">
      {goneAfter(gone, undefined, leaving)}
      {items.map((e, i) => {
        const heading = levelHeading(i === 0 ? from : items[i - 1]!.atLevel, e.atLevel, min);
        return (
          <Fragment key={e.key}>
            <li className="steplist__item">
              {heading && (
                <p className="steplist__level">
                  {heading === "from"
                    ? t("flow.fromLevel", { levelName: word, level: e.atLevel })
                    : t("flow.atLevel", { levelName: ptext(lp, "level.name") ?? "", level: e.atLevel })}
                </p>
              )}
              <StepLink entry={e} current={current} mark={lit?.has(e.key) ? "new" : undefined} />
            </li>
            {goneAfter(gone, e.key, leaving)}
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * The counted steps. The parts of a step (what a choice brought along, or
 * the steps of a gathered group such as one boon per level) show only
 * while the player is in that step: with 40 steps at a high level the list
 * stays as short as the count above the question.
 */
export function StepList({ current }: { current: string | undefined }) {
  const { t } = useApp();
  const { entries } = useDraft();
  const change = useContext(ChangeCtx);
  const list = useRef<HTMLDivElement>(null);
  const here = entries.find((e) => e.key === current);
  const heads = entries.filter((e) => e.part === 1);
  const leaving = change?.phase === "leave";
  const lit = change?.phase === "show" ? change : undefined;
  const wholeGone = (change?.gone ?? []).filter((g) => g.whole);
  /**
   * The mark of a step as it stands in the list: green when it came, or when
   * a part came that is not on show (its step is shut); red when only a part
   * went that is not on show.
   */
  const markOf = (head: FlowEntry, all: FlowEntry[], open: boolean): "new" | "lost" | undefined => {
    if (!lit) return undefined;
    if (lit.added.has(head.key) || (!open && all.some((e) => lit.added.has(e.key)))) return "new";
    if (!open && lit.gone.some((g) => !g.whole && g.section === head.key)) return "lost";
    return undefined;
  };
  // Keep the current step in view inside the scrolling column.
  useEffect(() => {
    list.current?.querySelector("[aria-current='step']")?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div className="steplist" ref={list}>
      <p className="steplist__title">{t("flow.steps")}</p>
      <ol className="steplist__items">
        {goneAfter(wholeGone, undefined, leaving)}
        {heads.map((head) => (
          <Fragment key={head.key}>
            <StepItem head={head} current={current} here={here} markOf={markOf} />
            {goneAfter(wholeGone, head.key, leaving)}
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

/** One counted step in the list, with its parts while the player is in it. */
function StepItem({
  head,
  current,
  here,
  markOf,
}: {
  head: FlowEntry;
  current: string | undefined;
  here: FlowEntry | undefined;
  markOf: (head: FlowEntry, all: FlowEntry[], open: boolean) => "new" | "lost" | undefined;
}) {
  const { t } = useApp();
  const { lp, entries } = useDraft();
  const all = entries.filter((e) => e.section === head.section);
  const parts = all.slice(1);
  const open = here !== undefined && here.section === head.section;
  const mark = markOf(head, all, open);
  if (head.sectionTitle === undefined || all.length === 1) {
    // Shut, the step is red if a part of it is, and leads there (AND-162).
    const red = open ? undefined : parts.find((e) => e.status === "needsAttention");
    return (
      <li className="steplist__item">
        <StepLink entry={red ? { ...red, title: head.title } : head} current={current} mark={mark} />
        {open && <LevelRuns section={head.key} items={parts} current={current} from={head.atLevel} />}
      </li>
    );
  }
  // A gathered group: its own name, the levels it spans, and its steps inside.
  const levels = levelSpan(all.map((e) => e.atLevel));
  // The span starts its line: the level's name as the package writes it ("Level 1 to 3").
  const span = levels && t("flow.levelSpan", { levelName: ptext(lp, "level.name") ?? "", ...levels });
  const target = all.find((e) => e.status !== "done") ?? head;
  return (
    <li className="steplist__item">
      <StepLink
        entry={{ ...target, title: head.sectionTitle, status: sectionStatus(all) }}
        current={open ? undefined : current}
        note={span}
        mark={open ? undefined : mark}
      />
      {open && <LevelRuns section={head.key} items={all} current={current} from={lp.pkg.flow.level.min} />}
    </li>
  );
}

/** The layout of /c/[id]: shell with step list in the menu and as a left column. */
export function FlowLayout({ current, children }: { current: string | undefined; children: ReactNode }) {
  const { t } = useApp();
  const { lp, ev, draft, doc, entries } = useDraft();
  const change = useStepChange(entries, doc.answers);
  const [content, setContent] = useState<ReactNode>(null);
  const explain = useMemo<ExplainApi>(() => ({ content, show: setContent }), [content]);
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name =
    nameState?.answer && typeof (nameState.answer as { text?: unknown }).text === "string"
      ? (nameState.answer as { text: string }).text.trim()
      : "";
  const wide = useWide();
  // Phones show the long explanation inside each card instead ("Learn more").
  const showAside = wide && current !== undefined && current !== OVERVIEW_KEY && current !== "level";
  useEffect(() => setContent(null), [current]);
  return (
    <ChangeCtx.Provider value={change}>
      <ExplainCtx.Provider value={explain}>
        <AppShell
          title={
            <span className="topbar__character">
              <span className="topbar__name">{name || t("common.unnamed")}</span>
              <span aria-hidden="true">·</span>
              <span className="topbar__level">
                {ptext(lp, "level.name")} {ev.level}
              </span>
              {/* A game master building for a player always sees whose character it is. */}
              {draft.access === "gameMaster" && (
                <span className="topbar__owner">{t("flow.forPlayer", { email: draft.owner.email })}</span>
              )}
            </span>
          }
          status={<SaveStatus />}
          menuMark={<MenuMark change={change} />}
          menuExtra={<StepList current={current} />}
          sidebar={wide ? <StepList current={current} /> : undefined}
          aside={
            showAside ? (
              <div className="explain-panel" aria-live="off">
                {content ?? <p className="explain-panel__empty">{t("option.explainEmpty")}</p>}
              </div>
            ) : undefined
          }
        >
          {children}
        </AppShell>
      </ExplainCtx.Provider>
    </ChangeCtx.Provider>
  );
}

/**
 * On phones the step list is shut in the menu: the menu button shows the
 * change in the same colours, "+1" green, "−1" red, for as long as the list
 * would. Wide screens show the list itself beside the question.
 */
function MenuMark({ change }: { change: ShownChange | null }) {
  if (change?.phase !== "show") return null;
  // Counted as the list shows them: a step that came with its parts is one.
  const gone = change.gone.length;
  const added = change.added.size;
  return (
    <span className="menu-mark" aria-hidden="true">
      {added > 0 && <span className="menu-mark__count menu-mark__count--new">+{added}</span>}
      {gone > 0 && <span className="menu-mark__count menu-mark__count--gone">−{gone}</span>}
    </span>
  );
}

/**
 * Green for a moment when a count grows, red when it shrinks: "Step 3 of
 * 12" says the change in the same colours as the step list, also on
 * phones, where the list is shut in the menu. A count of 0 is not shown:
 * a count that comes or goes is not marked.
 */
function useCountMark(count: number): "new" | "lost" | undefined {
  const [seen, setSeen] = useState(count);
  const [mark, setMark] = useState<"new" | "lost" | undefined>(undefined);
  if (seen !== count) {
    setSeen(count);
    if (seen > 0 && count > 0) setMark(count > seen ? "new" : "lost");
  }
  useEffect(() => {
    if (!mark) return;
    const timer = setTimeout(() => setMark(undefined), MARK_MS);
    return () => clearTimeout(timer);
  }, [mark, seen]);
  return mark;
}

function countClass(mark: "new" | "lost" | undefined): string {
  return mark ? `progress__count progress__count--${mark}` : "progress__count";
}

export function ProgressHeader({ entry }: { entry: FlowEntry }) {
  const { t } = useApp();
  const { lp, entries } = useDraft();
  const inFlow = entries.some((e) => e.key === entry.key);
  const pos = positionOf(entries, entry);
  const totalMark = useCountMark(pos.total);
  // A step that shows no part count yet (AND-189) gets one without a mark on its second part.
  const partsMark = useCountMark(pos.parts > 1 ? pos.parts : 0);
  // An earlier step opened from the overview during a level up: no count, it is not one of the new questions.
  if (!inFlow) {
    return (
      <div className="progress">
        <p className="progress__text">{t("raise.earlier")}</p>
      </div>
    );
  }
  const text = t("flow.progress", pos);
  const part = pos.parts > 1 ? t("flow.part", pos) : undefined;
  // A step a higher level brings says which level: the boons of levels 4 and 8 look alike.
  const level =
    entry.atLevel > lp.pkg.flow.level.min
      ? t("flow.atLevel", { levelName: ptext(lp, "level.name") ?? "", level: entry.atLevel })
      : undefined;
  const percent = Math.round(progressFraction(entries, entry) * 100);
  const full = [text, pos.sectionTitle, part, level].filter(Boolean).join(" · ");
  return (
    <div className="progress">
      <div
        className="progress__bar"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={pos.total}
        aria-valuenow={pos.current}
        aria-valuetext={full}
        aria-label={text}
      >
        <div className="progress__fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="progress__text">
        <span className={countClass(totalMark)} data-mark={totalMark}>
          {text}
        </span>
        <span aria-hidden="true"> · </span>
        <span className="progress__step">{pos.sectionTitle}</span>
        {part && (
          <span>
            <span aria-hidden="true"> · </span>
            <span className={countClass(partsMark)} data-mark={partsMark}>
              {part}
            </span>
          </span>
        )}
        {level && (
          <span>
            <span aria-hidden="true"> · </span>
            <span>{level}</span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * One sentence for screen readers when a choice added or removed steps or
 * parts; the count never changes without a word (AND-77). On screen the
 * step list shows it instead (AND-96). Spoken by the planned count, so it
 * speaks exactly when "Step x of y" or "Part x of y" changes.
 */
export function StepNotice() {
  const { tc, list } = useApp();
  const { notice } = useDraft();
  const lines: string[] = [];
  const say = (key: CountedKey, names: string[]) => {
    if (names.length > 0) lines.push(tc(key, names.length, { steps: list(names) }));
  };
  if (notice) {
    say("flow.stepAdded", notice.added);
    say("flow.partsAdded", notice.addedParts);
    say("flow.stepRemoved", notice.removed);
    say("flow.partsRemoved", notice.removedParts);
    say("flow.stepGrown", notice.grown);
  }
  return (
    <p aria-live="polite" className="step-notice visually-hidden">
      {lines.join(" ")}
    </p>
  );
}

/**
 * The question of a screen as its h1. Focus moves here when the step
 * changes, so screen readers start at the question.
 */
export function QuestionHeader({
  id,
  question,
  intro,
}: {
  id: string;
  question: ReactNode;
  intro?: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, [question]);
  return (
    <div className="question">
      <h1 className="question__title" id={id} tabIndex={-1} ref={ref}>
        {question}
      </h1>
      {intro && <p className="question__intro">{intro}</p>}
    </div>
  );
}

export function usePageTitle(parts: string[]) {
  const { t } = useApp();
  const title = [...parts.filter(Boolean), t("app.name")].join(" — ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** The rule core's reason for a refused change, in words that say what to do. */
function rejectedText(problem: string | undefined, t: ReturnType<typeof useApp>["t"]): string {
  switch (problem) {
    case "outOfRange":
      return t("flow.rejectedOutOfRange");
    case "overBudget":
      return t("flow.rejectedOverBudget");
    case "badAssignment":
      return t("flow.rejectedBadAssignment");
    default:
      return t("flow.rejected");
  }
}

export function StepFrame({
  entry,
  question,
  intro,
  introText,
  introVars,
  children,
  footer,
  laterLink,
  headingId: givenHeadingId,
}: {
  headingId?: string;
  entry: FlowEntry;
  question: string;
  intro?: ReactNode;
  introText?: string | undefined;
  introVars?: Record<string, string | number>;
  children: ReactNode;
  footer: ReactNode;
  /** "Choose for me" and "Decide later", under the intro (StepShortcuts). */
  laterLink?: ReactNode;
}) {
  const { t } = useApp();
  const { lp, entries, rejected } = useDraft();
  const autoId = useId();
  const headingId = givenHeadingId ?? autoId;
  const inFlow = entries.some((e) => e.key === entry.key);
  usePageTitle(inFlow ? [question, t("flow.progress", positionOf(entries, entry))] : [question]);
  return (
    <div className="step" aria-labelledby={headingId}>
      <ProgressHeader entry={entry} />
      <QuestionHeader
        id={headingId}
        question={question}
        intro={
          intro ??
          (introText !== undefined ? <RichText lp={lp} text={introText} vars={introVars} /> : undefined)
        }
      />
      {laterLink}
      <StepNotice />
      {rejected && (
        <Callout tone="danger" role="alert">
          {rejectedText(rejected.problem, t)}
        </Callout>
      )}
      <div className="step__content">{children}</div>
      {footer}
    </div>
  );
}

/**
 * The footer dock is fixed to the bottom on phones and sticks to the bottom
 * edge on larger screens. The page leaves room below the content as tall as
 * the fixed dock is now, so a reason shown in the dock never hides the last
 * answer, and focus never lands behind the dock (--dock-cover).
 */
export function useFooterDock() {
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      // Larger screens make the whole footer (the dock's parent) sticky.
      const footer = el.parentElement;
      const fixed = getComputedStyle(el).position === "fixed";
      const sticky = footer !== null && getComputedStyle(footer).position === "sticky";
      if (fixed) root.style.setProperty("--dock-height", `${el.offsetHeight}px`);
      else root.style.removeProperty("--dock-height");
      if (fixed) root.style.setProperty("--dock-cover", `${el.offsetHeight}px`);
      else if (sticky) root.style.setProperty("--dock-cover", `${footer.offsetHeight}px`);
      else root.style.removeProperty("--dock-cover");
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      root.style.removeProperty("--dock-height");
      root.style.removeProperty("--dock-cover");
    };
  }, []);
  return dock;
}

/** True once `on` has stayed true for `ms`; false again as soon as it is false. */
function useLate(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

/**
 * Where Next leads from a step. In the flow: the step after it. A step that
 * was still open when the player came to it from elsewhere (from the
 * overview, or an earlier step that a level up asked again and that is not
 * one of the new ones) goes on to the next open step, so the open steps run
 * one after the other to the overview. Only "Change" on a finished step
 * leads back to the overview.
 */
function useNextStep(entry: FlowEntry): { index: number; next: FlowEntry | undefined; toOverview: boolean } {
  const { entries, allEntries } = useDraft();
  const params = useSearchParams();
  // As it was when the player came here; answering the step does not change where it leads.
  const cameDone = useRef(entry.status === "done").current;
  const index = entries.findIndex((e) => e.key === entry.key);
  const aside = params.get("from") === "overview" || index < 0;
  if (!aside) return { index, next: entries[index + 1], toOverview: false };
  if (cameDone) return { index, next: undefined, toOverview: true };
  return { index, next: nextOpen(allEntries, entries, entry.key), toOverview: false };
}

/**
 * Back and Next. Next is never disabled: pressed too early, it says what is
 * missing right above itself and moves focus to the first open place. The
 * dock stays on screen on every size, so the reason and "Choose for me" are
 * in view wherever that place is.
 *
 * Pressed while the last answer is still on its way, Next waits for it and
 * then goes on by itself: one tap is enough on a slow connection. Until the
 * next step is on screen the button says so and further taps do nothing.
 * If saving fails, it goes on anyway; the top bar says the answer is not
 * saved yet, and saving keeps trying.
 */
export function StepFooter({
  entry,
  problem,
  onChooseForMe,
  nextLabel,
  focusTarget,
}: {
  entry: FlowEntry;
  /** What is still missing, or undefined if the step is complete. */
  problem: string | undefined;
  onChooseForMe?: (() => void) | undefined;
  nextLabel?: string;
  focusTarget?: () => HTMLElement | null;
}) {
  const { t } = useApp();
  const { entries, draft, raise, saveState, flush } = useDraft();
  const router = useRouter();
  const { index, next, toOverview } = useNextStep(entry);
  const [waiting, setWaiting] = useState(false);
  const [moving, startMoving] = useTransition();
  const busy = waiting || moving;
  // A quick save or step change shows no flicker; a slow one says what is going on.
  const late = useLate(busy, 300);
  // The tap on Next that waits for saving. Any other way out (a link, the
  // browser's Back, leaving the step) cancels it: the player's newer tap wins.
  const pending = useRef<symbol | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const cancel = () => {
      pending.current = null;
      setWaiting(false);
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a[href]")) cancel();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", cancel);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", cancel);
    };
  }, [waiting]);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );
  const [shown, setShown] = useState<string | undefined>(undefined);
  const prev = index < 0 ? entries.at(-1) : entries[index - 1];
  const reasonId = useId();
  const dock = useFooterDock();

  useEffect(() => {
    // Once the step is complete the reason goes away by itself.
    if (problem === undefined) setShown(undefined);
    else if (shown !== undefined) setShown(problem);
  }, [problem, shown]);

  const goNext = () => {
    if (problem !== undefined) {
      setShown(problem);
      requestAnimationFrame(() => focusTarget?.()?.focus());
      return;
    }
    if (!next) return;
    const href = next.href;
    const tap = Symbol();
    pending.current = tap;
    setWaiting(true);
    void flush().then(() => {
      if (pending.current !== tap) return;
      pending.current = null;
      setWaiting(false);
      startMoving(() => router.push(href));
    });
  };
  // Saving shown in the top bar already: the button says the same at once.
  const busyLabel =
    waiting && (late || saveState !== "saved") ? t("save.saving") : late ? t("flow.going") : undefined;

  return (
    <div className="step-footer">
      {/* On phones this whole dock is fixed to the bottom: the reason and
          "Choose for me" appear right above Next, never below the screen edge. */}
      <div className="step-footer__dock" ref={dock}>
        <div aria-live="polite" id={reasonId}>
          {shown !== undefined && (
            <div className="step-footer__reason">
              <Callout tone="warning">{shown}</Callout>
              {onChooseForMe && (
                <Button
                  variant="secondary"
                  icon="sparkle"
                  onClick={() => {
                    onChooseForMe();
                    setShown(undefined);
                  }}
                >
                  {t("flow.chooseForMe")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="step-footer__bar">
          {prev ? (
            <ButtonLink href={prev.href} variant="secondary" icon="arrowLeft">
              {t("common.back")}
            </ButtonLink>
          ) : (
            // The first new question of a level up goes back to the choice of level.
            <ButtonLink
              href={raise ? `/c/${draft.id}/raise` : "/characters"}
              variant="secondary"
              icon="arrowLeft"
            >
              {t("common.back")}
            </ButtonLink>
          )}
          {toOverview ? (
            <ButtonLink href={`/c/${draft.id}/overview`} iconAfter="arrowRight">
              {t("flow.backToOverview")}
            </ButtonLink>
          ) : (
            next && (
              <Button
                iconAfter="arrowRight"
                onClick={goNext}
                busy={busy}
                {...(busyLabel !== undefined ? { busyLabel } : {})}
                aria-describedby={shown ? reasonId : undefined}
              >
                {nextLabel ?? t("common.next")}
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** "Decide later": leave the step open and go on. */
export function LaterLink({ entry }: { entry: FlowEntry }) {
  const { t } = useApp();
  const { next } = useNextStep(entry);
  if (!next || entry.status === "done") return null;
  return (
    <p className="later">
      <Link href={next.href}>{t("flow.later")}</Link>
    </p>
  );
}

/**
 * The ways out of an open step, right under the intro: "Choose for me"
 * (when the package can suggest something) and "Decide later". Seen before
 * Next is ever pressed, so an intro that mentions the button keeps its word.
 * After the click a short note takes the button's place and gets focus;
 * the chosen values show in the step below.
 */
export function StepShortcuts({
  entry,
  open,
  onChooseForMe,
}: {
  entry: FlowEntry;
  /** True while the step still waits for an answer. */
  open: boolean;
  onChooseForMe: (() => void) | undefined;
}) {
  const { t } = useApp();
  const hintId = useId();
  const [chosen, setChosen] = useState(false);
  const note = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chosen) note.current?.focus();
  }, [chosen]);

  if (chosen && !open) {
    return (
      <div className="shortcuts__done" tabIndex={-1} ref={note}>
        <Callout tone="success" role="status">
          {t("flow.choseForMe")}
        </Callout>
      </div>
    );
  }
  if (!open) return null;
  return (
    <div className="shortcuts">
      {onChooseForMe && (
        <div className="shortcuts__choose">
          <Button
            variant="secondary"
            icon="sparkle"
            aria-describedby={hintId}
            onClick={() => {
              onChooseForMe();
              setChosen(true);
            }}
          >
            {t("flow.chooseForMe")}
          </Button>
          <p className="shortcuts__hint" id={hintId}>
            {t("flow.chooseForMeHint")}
          </p>
        </div>
      )}
      <LaterLink entry={entry} />
    </div>
  );
}
