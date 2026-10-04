"use client";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "./Icon.tsx";

/** Label above, field, help, error. The label is never only a placeholder. */
export const TextField = forwardRef<
  HTMLInputElement & HTMLTextAreaElement,
  {
    label: ReactNode;
    help?: ReactNode;
    error?: string | undefined;
    trailing?: ReactNode;
    multiline?: boolean;
    labelExtra?: ReactNode;
  } & Omit<InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>, "children">
>(function TextField(
  { label, help, error, trailing, multiline, labelExtra, id: given, className, ...rest },
  ref,
) {
  const auto = useId();
  const id = given ?? auto;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    className: "field__input",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className={`field${error ? " field--error" : ""}${className ? ` ${className}` : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {labelExtra && <span className="field__label-extra"> {labelExtra}</span>}
      </label>
      <div className="field__row">
        {multiline ? (
          <textarea ref={ref} rows={4} {...common} {...rest} />
        ) : (
          <input ref={ref} {...common} {...rest} />
        )}
        {trailing}
      </div>
      {error && (
        <p className="field__error" id={errorId}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
});

export interface SegmentOption<V extends string | number> {
  value: V;
  label: ReactNode;
  lang?: string;
}

/** 2–5 options side by side, equal width; a radio group underneath. */
export function Segmented<V extends string | number>({
  legend,
  legendHidden,
  options,
  value,
  onChange,
  name,
  help,
}: {
  legend: ReactNode;
  legendHidden?: boolean;
  options: readonly SegmentOption<V>[];
  value: V | undefined;
  onChange: (v: V) => void;
  name?: string;
  help?: ReactNode;
}) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <fieldset className="segmented">
      <legend className={legendHidden ? "visually-hidden" : "segmented__legend"}>{legend}</legend>
      <div className="segmented__track">
        {options.map((o) => {
          const id = `${group}-${o.value}`;
          return (
            <span className="segmented__item" key={String(o.value)}>
              <input
                type="radio"
                className="segmented__input"
                id={id}
                name={group}
                value={String(o.value)}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              <label className="segmented__label" htmlFor={id} {...(o.lang ? { lang: o.lang } : {})}>
                {o.label}
              </label>
            </span>
          );
        })}
      </div>
      {help && <p className="segmented__help">{help}</p>}
    </fieldset>
  );
}

/** "Learn more ▾" / "Show less ▴". */
export function Disclosure({
  more,
  less,
  children,
  className,
}: {
  more: string;
  less: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`disclosure${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          // Inside an option card: opening must not pick the option.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span>{open ? less : more}</span>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={20} />
      </button>
      <div id={id} className="disclosure__panel" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}

/** A short message; with an action it stays at least 10 s and pauses while focused or hovered. */
export function Toast({
  message,
  action,
  onAction,
  onDone,
  duration = 10_000,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
  onDone: () => void;
  duration?: number;
}) {
  const [paused, setPaused] = useState(false);
  const [left, setLeft] = useState(duration);
  // Count down in 250 ms ticks while not paused.
  useTick(!paused, 250, () => {
    setLeft((l) => {
      const next = l - 250;
      if (next <= 0) queueMicrotask(onDone);
      return next;
    });
  });
  return (
    <div
      className="toast"
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-left={left}
    >
      <span className="toast__text">{message}</span>
      {action && onAction && (
        <button type="button" className="toast__action" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function useTick(active: boolean, ms: number, fn: () => void) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
