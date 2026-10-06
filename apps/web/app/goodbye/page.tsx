"use client";
import { useEffect } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { ButtonLink } from "../../src/ui/components/Button.tsx";
import { GuestShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";

/** After "delete account": everything is gone, and the page says so. */
export default function GoodbyePage() {
  const { t, reloadAccount } = useApp();
  usePageTitle([t("goodbye.title")]);
  useEffect(() => {
    void reloadAccount().catch(() => {});
  }, [reloadAccount]);
  return (
    <GuestShell>
      <div className="auth">
        <div className="auth__card">
          <h1 className="auth__title">{t("goodbye.title")}</h1>
          <p className="auth__intro">{t("goodbye.text")}</p>
          <ButtonLink href="/login" block>
            {t("common.toStart")}
          </ButtonLink>
        </div>
      </div>
    </GuestShell>
  );
}
