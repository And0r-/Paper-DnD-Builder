"use client";
import { useApp } from "../src/ui/app-state.tsx";
import { Button } from "../src/ui/components/Button.tsx";
import { EmptyState } from "../src/ui/components/Feedback.tsx";
import { GuestShell } from "../src/ui/components/Shell.tsx";

/** Last resort for an unexpected error on a screen. Drafts are on the server, so nothing is lost. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useApp();
  return (
    <GuestShell>
      <div className="auth">
        <EmptyState icon="alert" title={t("common.errorTitle")}>
          <p>{t("common.errorText")}</p>
          <Button onClick={reset}>{t("common.retry")}</Button>
        </EmptyState>
      </div>
    </GuestShell>
  );
}
