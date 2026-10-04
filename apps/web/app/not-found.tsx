"use client";
import { useApp } from "../src/ui/app-state.tsx";
import { ButtonLink } from "../src/ui/components/Button.tsx";
import { EmptyState } from "../src/ui/components/Feedback.tsx";
import { GuestShell } from "../src/ui/components/Shell.tsx";

export default function NotFound() {
  const { t } = useApp();
  return (
    <GuestShell>
      <div className="auth">
        <EmptyState icon="alert" title={t("common.notFoundTitle")}>
          <p>{t("common.notFoundText")}</p>
          <ButtonLink href="/">{t("common.toStart")}</ButtonLink>
        </EmptyState>
      </div>
    </GuestShell>
  );
}
