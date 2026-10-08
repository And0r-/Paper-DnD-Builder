"use client";
/**
 * Live help on screen (AND-246), as a row under the top bar: who else is
 * on the character and where, what they point at, the last hint, and a
 * short line when the connection went. It is part of the sticky top, so
 * it never lies over an answer or the Back / Next bar (AND-90); the page
 * leaves room for it when it scrolls to a field (--livebar-height). Alone
 * on a character, nothing shows.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { TextField } from "../components/Fields.tsx";
import { Icon } from "../components/Icon.tsx";
import { useDraft } from "../flow/draft-state.tsx";
import { thingName } from "../package-text.ts";
import { HINT_MAX, type Person } from "./channel.ts";
import { hrefOfStep } from "./where.ts";

/** The connection must be gone this long before the line says so: a short blink says nothing. */
const LOST_AFTER_MS = 2500;
/** How long "Mara just changed something" stays. */
const CHANGED_MS = 4000;
/** How long the sender sees their own hint. */
const MINE_MS = 6000;
/** A hint is one sentence; the server would take more. */
const HINT_INPUT_MAX = Math.min(200, HINT_MAX);

/** The people on the character besides this window. */
export function useOthers(): Person[] {
  const { live } = useDraft();
  return live.people.filter((p) => p.id !== live.you?.id);
}

/** Whether this window may point and send hints: whoever helps, not the owner. */
export function useCanGuide(): boolean {
  const { live } = useDraft();
  const others = useOthers();
  return live.connection === "open" && live.you !== null && live.you.role !== "owner" && others.length > 0;
}

function usePersonName() {
  const { t } = useApp();
  return (p: Person) => t(`live.person.${p.role}`, { name: p.name });
}

/** A step's title as the step list has it, or the screen's own word. */
function useStepTitle() {
  const { t } = useApp();
  const { allEntries } = useDraft();
  return (step: string): string | null => {
    const entry = allEntries.find((e) => e.key === step);
    if (entry) return entry.sectionTitle ?? entry.title;
    if (step === "done" || step === "raise" || step === "bogen") return t(`live.screen.${step}`);
    return null;
  };
}

/** Moves the card someone points at into view, gently unless motion is reduced. */
export function showPointed(thing: string) {
  const card = document.querySelector<HTMLElement>(`[data-option="${CSS.escape(thing)}"]`);
  if (!card) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
}

function PersonChip({ person }: { person: Person }) {
  const { t } = useApp();
  const { lp, draft } = useDraft();
  const nameOf = usePersonName();
  const titleOf = useStepTitle();
  const step = person.step ? titleOf(person.step) : null;
  const href = person.step ? hrefOfStep(draft.id, person.step) : null;
  const pointed = person.point ? thingName(lp, person.point) : "";
  return (
    <li className="livebar__person">
      <span className="livebar__dot" aria-hidden="true" />
      <span className="livebar__name">{nameOf(person)}</span>
      <span className="visually-hidden">, {t("live.connected")}</span>
      {step &&
        (href ? (
          <Link
            className="livebar__where"
            href={href}
            aria-label={t("live.atLabel", { step, name: person.name })}
          >
            {t("live.at", { step })}
          </Link>
        ) : (
          <span className="livebar__where">{t("live.at", { step })}</span>
        ))}
      {person.point && pointed && (
        <button
          type="button"
          className="livebar__points"
          onClick={() => showPointed(person.point!)}
          aria-label={t("live.pointsLabel", { name: person.name, thing: pointed })}
        >
          <Icon name="target" size={16} />
          <span>{t("live.points", { name: person.name, thing: pointed })}</span>
        </button>
      )}
    </li>
  );
}

function HintComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useApp();
  const { live } = useDraft();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError(t("live.hintEmpty"));
      return;
    }
    if (!live.sendHint(text)) {
      setError(t("live.hintFailed"));
      return;
    }
    setText("");
    setError(undefined);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("live.hintTitle")} variant="sheet">
      <form className="hint-form" onSubmit={submit} noValidate>
        <TextField
          label={t("live.hintLabel")}
          help={t("live.hintHelp")}
          error={error}
          value={text}
          maxLength={HINT_INPUT_MAX}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <div className="hint-form__actions">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" icon="send">
            {t("live.hintSend")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HintBubble() {
  const { t } = useApp();
  const { live } = useDraft();
  const { hint, dismissHint } = live;
  // The sender sees what went out for a moment; the others keep it until they tap it or go on.
  useEffect(() => {
    if (!hint?.mine) return;
    const timer = setTimeout(dismissHint, MINE_MS);
    return () => clearTimeout(timer);
  }, [hint, dismissHint]);
  if (!hint) return null;
  return (
    // One button: a tap anywhere on the bubble puts it away.
    <button
      type="button"
      className={`hint-bubble${hint.mine ? " hint-bubble--mine" : ""}`}
      onClick={dismissHint}
      data-hint
    >
      <span className="hint-bubble__words">
        <span className="hint-bubble__from">
          {hint.mine ? t("live.hintMine") : t("live.hintFrom", { name: hint.from.name })}
        </span>{" "}
        <span className="hint-bubble__text">{hint.text}</span>
      </span>
      <span className="hint-bubble__close">
        <Icon name="close" size={18} />
        <span className="visually-hidden">{t("live.hintClose")}</span>
      </span>
    </button>
  );
}

/** True once `on` has stayed true for `ms`. */
function useAfter(on: boolean, ms: number): boolean {
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

export function LiveBar() {
  const { t } = useApp();
  const { live, changedBy } = useDraft();
  const others = useOthers();
  const canGuide = useCanGuide();
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The line about a lost connection matters only where someone else builds along.
  const [hadCompany, setHadCompany] = useState(false);
  if (others.length > 0 && !hadCompany) setHadCompany(true);
  const helping = live.you !== null && live.you.role !== "owner";
  const lost = useAfter(live.connection === "lost", LOST_AFTER_MS) && (hadCompany || helping);

  const [changed, setChanged] = useState<number | null>(null);
  useEffect(() => {
    if (!changedBy) return;
    setChanged(changedBy.seq);
    const timer = setTimeout(() => setChanged(null), CHANGED_MS);
    return () => clearTimeout(timer);
  }, [changedBy]);

  const shown = others.length > 0 || lost || live.hint !== null;

  // The page keeps fields clear of the row when it scrolls to them (base.css, scroll-padding-top).
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => root.style.setProperty("--livebar-height", `${el.offsetHeight}px`);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      root.style.removeProperty("--livebar-height");
    };
  }, [shown]);

  return (
    <>
      <div className="livebar" ref={ref} hidden={!shown} data-live={live.connection}>
        {others.length > 0 && (
          <div className="livebar__row">
            <p className="livebar__label">{t("live.with")}</p>
            <ul className="livebar__people">
              {others.map((p) => (
                <PersonChip key={p.id} person={p} />
              ))}
            </ul>
            {canGuide && (
              <Button
                variant="ghost"
                icon="send"
                className="livebar__hint-button"
                aria-haspopup="dialog"
                onClick={() => setComposing(true)}
              >
                {t("live.hintButton")}
              </Button>
            )}
          </div>
        )}
        <div aria-live="polite">
          {lost && (
            <p className="livebar__lost" role="status">
              <Icon name="refresh" size={16} />
              <span>{t("live.lost")}</span>
            </p>
          )}
          {changed !== null && changedBy && others.length > 0 && (
            <p className="livebar__changed">{t("live.changedBy", { name: changedBy.name })}</p>
          )}
          <HintBubble />
        </div>
      </div>
      <HintComposer open={composing} onClose={() => setComposing(false)} />
    </>
  );
}
