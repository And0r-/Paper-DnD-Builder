"use client";
/**
 * The frame every creation step shares (flow spec 2): top bar with name
 * and save status, step list, progress, the question, and Back / Next.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "../app-state.tsx";
import { Button, ButtonLink } from "../components/Button.tsx";
import { Callout } from "../components/Feedback.tsx";
import { Icon } from "../components/Icon.tsx";
import { RichText } from "../components/RichText.tsx";
import { AppShell } from "../components/Shell.tsx";
import { ptext } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";
import { OVERVIEW_KEY, positionOf, progressFraction, type FlowEntry } from "./model.ts";

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

function StepLink({ entry, current }: { entry: FlowEntry; current: string | undefined }) {
  const { t } = useApp();
  const here = entry.key === current;
  const state = here ? "current" : entry.status;
  return (
    <Link
      href={entry.href}
      aria-current={here ? "step" : undefined}
      className={`steplist__link steplist__link--${state}`}
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
      <span className="steplist__name">{entry.title}</span>
      <span className="visually-hidden">, {t(`flow.status.${state}`)}</span>
    </Link>
  );
}

/** The counted steps; the parts a choice brought along are listed inside their step. */
export function StepList({ current }: { current: string | undefined }) {
  const { t } = useApp();
  const { entries } = useDraft();
  const heads = entries.filter((e) => e.part === 1);
  return (
    <div className="steplist">
      <p className="steplist__title">{t("flow.steps")}</p>
      <ol className="steplist__items">
        {heads.map((head) => {
          const parts = entries.filter((e) => e.section === head.section && e.part > 1);
          return (
            <li key={head.key} className="steplist__item">
              <StepLink entry={head} current={current} />
              {parts.length > 0 && (
                <ol className="steplist__parts">
                  {parts.map((e) => (
                    <li key={e.key} className="steplist__item">
                      <StepLink entry={e} current={current} />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The layout of /c/[id]: shell with step list in the menu and as a left column. */
export function FlowLayout({ current, children }: { current: string | undefined; children: ReactNode }) {
  const { t } = useApp();
  const { lp, ev } = useDraft();
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
    <ExplainCtx.Provider value={explain}>
      <AppShell
        title={
          <span className="topbar__character">
            <span className="topbar__name">{name || t("common.unnamed")}</span>
            <span aria-hidden="true">·</span>
            <span>
              {ptext(lp, "level.name")} {ev.level}
            </span>
          </span>
        }
        status={<SaveStatus />}
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
  );
}

export function ProgressHeader({ entry }: { entry: FlowEntry }) {
  const { t } = useApp();
  const { entries } = useDraft();
  const pos = positionOf(entries, entry);
  const text = t("flow.progress", pos);
  const part = pos.parts > 1 ? t("flow.part", pos) : undefined;
  const percent = Math.round(progressFraction(entries, entry) * 100);
  const full = [text, pos.sectionTitle, part].filter(Boolean).join(" · ");
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
        <span>{text}</span>
        <span aria-hidden="true"> · </span>
        <span className="progress__step">{pos.sectionTitle}</span>
        {part && (
          <>
            <span aria-hidden="true"> · </span>
            <span>{part}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Note when a choice added or removed steps or parts, in one short line;
 * the count never changes without a word. Which ones they are stands in
 * the step list and the progress line, not in the note. A switch that
 * swaps parts only says what the new choice brings.
 */
export function StepNotice() {
  const { tc, list } = useApp();
  const { notice } = useDraft();
  const lines: string[] = [];
  if (notice?.addedParts.length) lines.push(tc("flow.partsAdded", notice.addedParts.length));
  else if (notice?.removedParts.length) lines.push(tc("flow.partsRemoved", notice.removedParts.length));
  // After a first sentence the step count follows in a few words.
  const too = lines.length > 0 ? "Too" : "";
  if (notice?.added.length) lines.push(tc(`flow.stepAdded${too}`, notice.added.length));
  if (notice?.removed.length) lines.push(tc(`flow.stepRemoved${too}`, notice.removed.length));
  if (notice?.grown.length)
    lines.push(tc("flow.stepGrown", notice.grown.length, { steps: list(notice.grown) }));
  return <div aria-live="polite">{lines.length > 0 && <Callout tone="info">{lines.join(" ")}</Callout>}</div>;
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
  usePageTitle([question, t("flow.progress", positionOf(entries, entry))]);
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
          {t("flow.rejected")}
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

/**
 * Back and Next. Next is never disabled: pressed too early, it says what is
 * missing right above itself and moves focus to the first open place. The
 * dock stays on screen on every size, so the reason and "Choose for me" are
 * in view wherever that place is.
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
  const { entries, draft } = useDraft();
  const router = useRouter();
  const params = useSearchParams();
  const toOverview = params.get("from") === "overview";
  const [shown, setShown] = useState<string | undefined>(undefined);
  const index = entries.findIndex((e) => e.key === entry.key);
  const prev = entries[index - 1];
  const next = entries[index + 1];
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
    if (next) router.push(next.href);
  };

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
            <ButtonLink href="/characters" variant="secondary" icon="arrowLeft">
              {t("common.back")}
            </ButtonLink>
          )}
          {toOverview ? (
            <ButtonLink href={`/c/${draft.id}/overview`} iconAfter="arrowRight">
              {t("flow.backToOverview")}
            </ButtonLink>
          ) : (
            next && (
              <Button iconAfter="arrowRight" onClick={goNext} aria-describedby={shown ? reasonId : undefined}>
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
  const { entries } = useDraft();
  const next = entries[entries.findIndex((e) => e.key === entry.key) + 1];
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
