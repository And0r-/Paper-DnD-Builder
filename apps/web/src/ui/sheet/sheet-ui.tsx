"use client";
/**
 * What a sheet design draws with (`SheetUi`): texts that turn into an input
 * at the same place when tapped, places to write and tick, and buttons for
 * rows. Tap, type, done: Enter, Tab or a tap elsewhere keeps the change,
 * Escape takes it back. No window, no question, nothing opens below.
 */
import {
  pencilValue,
  tickAt,
  ticksOf,
  withRowAdded,
  withText,
  writtenOf,
  type PlayValue,
  type SheetModel,
} from "@builder/sheet";
import type { SheetFieldProps, SheetRowProps, SheetTextProps, SheetUi } from "@builder/sheet/designs/screens";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useApp } from "../app-state.tsx";
import { Icon } from "../components/Icon.tsx";
import type { SheetController } from "./sheet-state.ts";

const Ctx = createContext<SheetController | null>(null);

export function SheetUiProvider({ sheet, children }: { sheet: SheetController; children: ReactNode }) {
  return <Ctx.Provider value={sheet}>{children}</Ctx.Provider>;
}

function useSheetCtx(): SheetController {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("sheet ui outside SheetUiProvider");
  return ctx;
}

/**
 * The text a row just added starts with, as its path: it opens for typing
 * as soon as it is on the screen. Outside React state, so it outlives the
 * sheet being drawn anew (the first change to the original makes a copy).
 */
let openNext: string | null = null;

/** The first text of the last row of section `index`. */
function lastRowStart(model: SheetModel, index: number): (string | number)[] | null {
  const s = model.sections[index];
  if (s?.kind === "list") return ["sections", index, "items", s.items.length - 1];
  if (s?.kind === "statTable" || s?.kind === "featureTable")
    return ["sections", index, "rows", s.rows.length - 1, "name"];
  return null;
}

/** A plain number ("12", "+2") brings up the number pad on a phone. */
const NUMBER = /^[+-−]?\d+$/u;

function SheetText({ path, value, label, multiline, shown: display }: SheetTextProps) {
  const { t } = useApp();
  const sheet = useSheetCtx();
  const [editing, setEditing] = useState(false);
  const shown = useRef<HTMLSpanElement>(null);
  const width = useRef(0);
  const refocus = useRef(false);
  const key = JSON.stringify(path);
  useEffect(() => {
    if (openNext !== key) return;
    openNext = null;
    if (sheet.editable) setEditing(true);
  }, [key, sheet.editable]);

  if (!sheet.editable) return <>{display ?? value}</>;

  const stop = (keep: boolean, text: string) => {
    setEditing(false);
    if (keep && text !== value) sheet.changeModel((m) => withText(m, path, text));
    // After Enter or Escape, back on the text, so the keyboard goes on from where it was.
    if (refocus.current) requestAnimationFrame(() => shown.current?.focus({ preventScroll: true }));
    refocus.current = false;
  };

  if (editing) {
    const common = {
      className: `sheet-edit${multiline ? " sheet-edit--multiline" : ""}`,
      defaultValue: value,
      "aria-label": label,
      autoFocus: true,
      onBlur: (e: { currentTarget: { value: string } }) => stop(true, e.currentTarget.value),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
          e.preventDefault();
          refocus.current = true;
          e.currentTarget.value = value;
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !(multiline && e.shiftKey)) {
          e.preventDefault();
          refocus.current = true;
          e.currentTarget.blur();
        }
      },
      onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => e.currentTarget.select(),
      style: { minWidth: `${Math.max(width.current, 24)}px` },
    };
    return multiline ? (
      <textarea {...common} rows={Math.max(1, Math.ceil(value.length / 60))} />
    ) : (
      <input {...common} type="text" inputMode={NUMBER.test(value) ? "numeric" : undefined} />
    );
  }
  const begin = () => {
    width.current = shown.current?.getBoundingClientRect().width ?? 0;
    setEditing(true);
  };
  return (
    <span
      ref={shown}
      className={`sheet-text${value === "" ? " sheet-text--empty" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("sheet.change", { label, value: value === "" ? t("sheet.empty") : value })}
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          begin();
        }
      }}
    >
      {display ?? value}
    </span>
  );
}

function SheetField({ field, label, shape = "square", lines }: SheetFieldProps) {
  const { t } = useApp();
  const sheet = useSheetCtx();
  const stored: PlayValue | undefined = sheet.state[field.id];

  if (field.kind === "ticks") {
    const ticked = ticksOf(stored, field.max);
    return (
      <span
        className={`sheet-ticks sheet-ticks--${shape}`}
        role="group"
        aria-label={label}
        data-field={field.id}
      >
        {Array.from({ length: field.max }, (_, i) => (
          <button
            key={i}
            type="button"
            className="sheet-tick"
            aria-pressed={i < ticked}
            aria-label={t("sheet.tick", { label, n: i + 1, max: field.max })}
            onClick={() => {
              const next = tickAt(ticked, i);
              sheet.setField(field.id, next === 0 ? undefined : { checks: next });
            }}
          />
        ))}
      </span>
    );
  }
  return <WrittenField field={field} label={label} lines={lines} value={writtenOf(stored)} />;
}

/** A pause in typing this long saves what is written so far. */
const WRITE_PAUSE_MS = 600;

/**
 * A box or lines to write on. Saved while writing (after a short pause),
 * when left, and when the page is left or hidden: a note typed just before
 * a reload or closing the tab is not lost.
 */
function WrittenField({
  field,
  label,
  lines,
  value,
}: Pick<SheetFieldProps, "field" | "label"> & { lines: number | undefined; value: string }) {
  const { setField } = useSheetCtx();
  const [text, setText] = useState(value);
  // What another device or a reload brings, unless it is being written in.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  // The latest text and stored value, for a save from a timer or a page event.
  const latest = useRef({ text, value });
  useEffect(() => {
    latest.current = { text, value };
  }, [text, value]);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = useCallback(() => {
    clearTimeout(pause.current);
    pause.current = undefined;
    const { text: now, value: stored } = latest.current;
    const next = field.kind === "pencil" ? pencilValue(now) : now.trim() === "" ? undefined : now;
    if (writtenOf(next) !== stored) {
      setField(field.id, next);
      // Saved: the stored value is this now, even before the next render.
      latest.current = { text: now, value: writtenOf(next) };
    }
  }, [field.id, field.kind, setField]);
  useEffect(() => {
    const leave = () => {
      if (pause.current !== undefined) keep();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      // Gone from the screen (another version, another page) with something unsaved.
      leave();
    };
  }, [keep]);
  const common = {
    value: text,
    "aria-label": label,
    "data-field": field.id,
    onChange: (e: { currentTarget: { value: string } }) => {
      const next = e.currentTarget.value;
      setText(next);
      latest.current = { ...latest.current, text: next };
      clearTimeout(pause.current);
      pause.current = setTimeout(keep, WRITE_PAUSE_MS);
    },
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      keep();
    },
  };
  if (field.kind === "text" && lines !== undefined && lines > 0) {
    return (
      <textarea
        {...common}
        className="sheet-lines"
        rows={lines}
        style={{ "--sheet-lines": String(lines) } as CSSProperties}
      />
    );
  }
  return (
    <input
      {...common}
      type="text"
      className={field.kind === "pencil" ? "sheet-pencil" : "sheet-write"}
      inputMode={field.kind === "pencil" ? "numeric" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function AddRow({ section, label }: SheetRowProps) {
  const { t } = useApp();
  const sheet = useSheetCtx();
  if (!sheet.editable) return null;
  return (
    <button
      type="button"
      className="sheet-row-add"
      aria-label={t("sheet.addRowLabel", { section: label })}
      onClick={() =>
        sheet.changeModel((m) => {
          const next = withRowAdded(m, section);
          const start = next === m ? null : lastRowStart(next, section);
          openNext = start && JSON.stringify(start);
          return next;
        })
      }
    >
      <Icon name="plus" size={18} />
      <span>{t("sheet.addRow")}</span>
    </button>
  );
}

function RemoveRow({ section, row, label }: SheetRowProps & { row: number }) {
  const { t } = useApp();
  const sheet = useSheetCtx();
  if (!sheet.editable) return null;
  return (
    <button
      type="button"
      className="sheet-row-remove"
      aria-label={t("sheet.removeRow", { section: label, n: row + 1 })}
      onClick={() => sheet.removeRow(section, row)}
    >
      <Icon name="close" size={16} />
    </button>
  );
}

export const SHEET_UI: SheetUi = { Text: SheetText, Field: SheetField, AddRow, RemoveRow };
