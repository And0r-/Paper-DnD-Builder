"use client";
/**
 * A new access key, shown this once to copy. The server keeps only a check
 * value, so after "Done" or a reload the key is gone from the screen for good.
 */
import { useId, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";
import { Callout } from "./Feedback.tsx";

export function FreshKey({
  secret,
  title,
  label,
  onDone,
  children,
}: {
  secret: string;
  title: string;
  label: string;
  onDone: () => void;
  children?: ReactNode;
}) {
  const { t } = useApp();
  const inputId = useId();
  const [copied, setCopied] = useState(false);
  return (
    <Callout tone="warning" title={title}>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
        <div className="field__row">
          <input
            id={inputId}
            className="field__input access-keys__secret"
            readOnly
            value={secret}
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            variant="secondary"
            {...(copied ? { icon: "check" as const } : {})}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                setCopied(true);
              } catch {
                // No clipboard (plain HTTP): the key is selected for copying by hand.
                document.getElementById(inputId)?.focus();
              }
            }}
          >
            {copied ? t("settings.keyCopied") : t("settings.keyCopy")}
          </Button>
        </div>
      </div>
      {children}
      <Button variant="ghost" onClick={onDone}>
        {t("settings.keyDone")}
      </Button>
    </Callout>
  );
}
