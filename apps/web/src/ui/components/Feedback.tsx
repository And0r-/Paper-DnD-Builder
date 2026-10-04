"use client";
/**
 * The designed states of anything that loads: callout, empty, loading
 * (skeleton, nothing for the first 400 ms, a sentence after 5 s) and error.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export type CalloutTone = "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<CalloutTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
};

export function Callout({
  tone,
  title,
  children,
  role,
  id,
}: {
  tone: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status";
  id?: string;
}) {
  return (
    <div className={`callout callout--${tone}`} role={role} id={id}>
      <Icon name={TONE_ICON[tone]} className="callout__icon" />
      <div className="callout__body">
        {title && <p className="callout__title">{title}</p>}
        {children && <div className="callout__text">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = "figure",
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={64} className="empty__icon" />
      <p className="empty__title">{title}</p>
      {children && <div className="empty__action">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string | undefined; onRetry?: () => void }) {
  const { t } = useApp();
  return (
    <div className="error-state" role="alert">
      <Icon name="alert" size={40} className="error-state__icon" />
      <p className="error-state__text">{message ?? t("common.loadError")}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

function useElapsed(): "quiet" | "loading" | "slow" {
  const [phase, setPhase] = useState<"quiet" | "loading" | "slow">("quiet");
  useEffect(() => {
    const a = setTimeout(() => setPhase("loading"), 400);
    const b = setTimeout(() => setPhase("slow"), 5000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return phase;
}

/** Placeholder in the shape of the content. Shows nothing for the first 400 ms to avoid flicker. */
export function Loading({ shape = "cards", count = 3 }: { shape?: "cards" | "page"; count?: number }) {
  const { t } = useApp();
  const phase = useElapsed();
  return (
    <div className="loading" aria-busy="true">
      <span className="visually-hidden" role="status">
        {phase !== "quiet" ? t("common.loading") : ""}
      </span>
      {phase !== "quiet" && (
        <div aria-hidden="true">
          {shape === "page" && (
            <>
              <div className="skeleton skeleton--line skeleton--short" />
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--line" />
            </>
          )}
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="skeleton skeleton--card" />
          ))}
        </div>
      )}
      {phase === "slow" && <p className="loading__slow">{t("common.loadingSlow")}</p>}
    </div>
  );
}
