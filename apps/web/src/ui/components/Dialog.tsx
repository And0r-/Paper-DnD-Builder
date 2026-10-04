"use client";
/**
 * Dialogs on the native <dialog> element: the browser traps focus, Escape
 * closes, and focus returns to the trigger. Escape and the first button
 * are always the safe way out.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  variant = "center",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `sheet`: from the bottom on phones (glossary). */
  variant?: "center" | "sheet";
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onClosed = () => {
      const target = returnTo.current;
      if (target && document.contains(target)) target.focus();
    };
    d.addEventListener("cancel", onCancel);
    d.addEventListener("close", onClosed);
    return () => {
      d.removeEventListener("cancel", onCancel);
      d.removeEventListener("close", onClosed);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${variant}`}
      aria-labelledby={labelledBy ?? titleId}
      onClick={(e) => {
        // A tap on the backdrop (the dialog element itself, outside its box) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__box">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          {children && <div className="dialog__body">{children}</div>}
          {footer && <div className="dialog__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  cancelLabel,
  confirmLabel,
  danger,
  busy,
  busyLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useApp();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          {/* First in the DOM, so the browser focuses the safe choice. */}
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            busy={busy ?? false}
            {...(busyLabel ? { busyLabel } : {})}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Confirmation by typing a word (account deletion only). */
export function TypedConfirmDialog({
  open,
  title,
  children,
  word,
  label,
  mismatch,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  word: string;
  label: string;
  mismatch: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useApp();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const id = useId();
  const close = () => {
    setValue("");
    setError(false);
    onCancel();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            busy={busy ?? false}
            onClick={() => {
              if (value.trim().toLocaleUpperCase() !== word.toLocaleUpperCase()) {
                setError(true);
                document.getElementById(id)?.focus();
                return;
              }
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <div className={`field${error ? " field--error" : ""}`}>
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="field__input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
        />
        {error && (
          <p className="field__error" id={`${id}-error`}>
            <span aria-hidden="true">⚠ </span>
            {mismatch}
          </p>
        )}
      </div>
    </Dialog>
  );
}
