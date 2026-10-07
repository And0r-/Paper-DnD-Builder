"use client";
/**
 * A piece of text to copy: an address or a command, shown in full, with a
 * Copy button. Without a clipboard (plain HTTP) the text is selected, so it
 * can be copied by hand.
 */
import { useId, useRef, useState } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";

export function CopyText({ label, value }: { label: string; value: string }) {
  const { t } = useApp();
  const labelId = useId();
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-text">
      <p className="field__label" id={labelId}>
        {label}
      </p>
      <div className="copy-text__row">
        <pre className="copy-text__value" aria-labelledby={labelId} tabIndex={0} translate="no">
          <code ref={ref}>{value}</code>
        </pre>
        <Button
          variant="secondary"
          aria-label={copied ? undefined : `${t("settings.keyCopy")}: ${label}`}
          {...(copied ? { icon: "check" as const } : {})}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              const el = ref.current;
              if (!el) return;
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
          }}
        >
          {copied ? t("settings.keyCopied") : t("settings.keyCopy")}
        </Button>
      </div>
    </div>
  );
}
