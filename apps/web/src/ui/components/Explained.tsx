"use client";
/**
 * A common name with a one-sentence explanation (AND-87). The name stays as
 * people say it at the table; the sentence shows on hover, on keyboard focus
 * and on tap. A second tap, a tap elsewhere or Escape closes it.
 *
 * `Term` makes the word itself the trigger. `Explained` wraps a link or a
 * button that already does something (follow, download): hover and focus on
 * it show the sentence, and a small info button next to it shows it on tap.
 *
 * A tapped `Term` shows its sentence in the text, under the word, and moves
 * the lines below down: a bubble on top would hide them on a phone (AND-90).
 * Hover and keyboard focus keep the bubble; it goes when the pointer does.
 */
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app-state.tsx";
import { Icon } from "./Icon.tsx";

/** Gap between the word and the bubble, and to the screen edge, in px. */
const GAP = 8;

interface Place {
  top: number;
  left: number;
  width: number;
}

function useHint(inline = false) {
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<Place>();
  const shown = hover || focus || pinned;
  // The bubble; a pinned inline explanation stands in the text instead.
  const floating = inline ? (hover || focus) && !pinned : shown;

  // Fixed position next to the word, kept inside the screen: escapes the
  // clipping of the top bar and never pushes the page sideways.
  const measure = useCallback(() => {
    const b = box.current;
    const h = bubble.current;
    if (!b || !h) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(320, vw - 2 * GAP);
    const left = Math.min(Math.max(GAP, r.left), vw - width - GAP);
    const height = h.offsetHeight;
    const below = r.bottom + GAP;
    const top = below + height > vh - GAP && r.top - GAP - height > GAP ? r.top - GAP - height : below;
    setPlace({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!floating) return;
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [floating, measure]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setHover(false);
      setFocus(false);
    };
    // A tap anywhere else closes a pinned explanation. On the click, not when
    // the finger lands: a sentence in the text that closes earlier moves the
    // words below it, and the tap would miss the one it was meant for.
    // Capture, so a word that keeps its click to itself still closes this one.
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
    };
  }, [shown]);

  const triggers = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setHover(true);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setHover(false);
    },
    // Only keyboard focus shows it; a tap focuses too, but taps pin instead.
    onFocus: (e: FocusEvent<HTMLElement>) => setFocus(e.target.matches(":focus-visible")),
    onBlur: () => setFocus(false),
  };

  // The bubble lives at the end of the page: the sentence around the word keeps its own text.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const node = (text: string) =>
    mounted &&
    createPortal(
      <span
        ref={bubble}
        id={id}
        role="tooltip"
        className={`hint${floating ? " hint--shown" : ""}`}
        style={place ? { top: place.top, left: place.left, width: place.width } : undefined}
      >
        {text}
      </span>,
      document.body,
    );

  return { id, box, shown, pinned, setPinned, triggers, node };
}

/** A word that explains itself on hover, focus and tap. */
export function Term({ hint, children }: { hint: string | undefined; children: ReactNode }) {
  const h = useHint(true);
  if (!hint) return <>{children}</>;
  return (
    <span className="term" ref={h.box} {...h.triggers}>
      <button
        type="button"
        className="term__word"
        aria-describedby={h.id}
        aria-expanded={h.pinned}
        onClick={(e) => {
          // Inside an option card or a link: explaining must not do anything else.
          e.preventDefault();
          e.stopPropagation();
          h.setPinned((p) => !p);
        }}
      >
        {children}
      </button>
      {h.pinned && (
        <span className="term__inline" aria-hidden="true">
          {hint}
        </span>
      )}
      {h.node(hint)}
    </span>
  );
}

/**
 * A link or button with an explanation: hover and focus on it show the
 * sentence; the info button next to it shows it on tap.
 */
export function Explained({
  hint,
  children,
  block,
}: {
  hint: string;
  /** The link or button; it gets `aria-describedby` and the hover handlers. */
  children: ReactElement<Record<string, unknown>>;
  /** The element takes the whole row; the info button sits at its end. */
  block?: boolean;
}) {
  const { t } = useApp();
  const h = useHint();
  return (
    <span className={`explained${block ? " explained--block" : ""}`} ref={h.box}>
      {cloneElement(children, { "aria-describedby": h.id, ...h.triggers })}
      <button
        type="button"
        className="explained__info"
        aria-label={t("common.whatIsThis")}
        aria-describedby={h.id}
        aria-expanded={h.pinned}
        {...h.triggers}
        onClick={() => h.setPinned((p) => !p)}
      >
        <Icon name="info" size={20} />
      </button>
      {h.node(hint)}
    </span>
  );
}
