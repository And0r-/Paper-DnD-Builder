"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

const ITEM = '[role="menuitem"]';

/**
 * A "more" button with a small menu (WAI-ARIA menu button). Opening puts
 * the focus on the first entry; the arrow keys, Home and End move through
 * the entries, Escape closes and goes back to the button, Tab leaves it.
 * A click on an entry or anywhere outside closes it too. Entries are
 * links or buttons with `role="menuitem"`.
 */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Which entry gets the focus once the menu is drawn: the first or the last.
  const focusOnOpen = useRef<"first" | "last">("first");

  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);

  useEffect(() => {
    if (!open) return;
    const all = items();
    all[focusOnOpen.current === "last" ? all.length - 1 : 0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const show = (at: "first" | "last") => {
    focusOnOpen.current = at;
    setOpen(true);
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className="menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show("first"))}
        onKeyDown={onTriggerKey}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          className="popover"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A line between groups of entries, e.g. before the one that deletes. */
export function MenuSeparator() {
  return <div className="popover__separator" role="separator" />;
}
