"use client";
/**
 * Everything under /c/[id]: the draft is loaded once and shared by the
 * level screen, the steps, the overview and the end screen.
 */
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { ButtonLink } from "../../../src/ui/components/Button.tsx";
import { EmptyState, ErrorState, Loading } from "../../../src/ui/components/Feedback.tsx";
import { AppShell } from "../../../src/ui/components/Shell.tsx";
import { DraftProvider } from "../../../src/ui/flow/draft-state.tsx";
import { FlowLayout } from "../../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../../src/ui/guards.tsx";

function currentKey(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[2] === "level") return "level";
  if (parts[2] === "overview") return "overview";
  if (parts[2] === "step" && parts[3]) return decodeURIComponent(parts[3]);
  return undefined;
}

export default function DraftLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { t } = useApp();
  const current = currentKey(pathname);
  // The end and the level-up question stand on their own, without the step list.
  const isEnd = pathname.endsWith("/done") || pathname.endsWith("/raise");
  // The sheet brings its own frame: its tools go into the menu.
  const isSheet = pathname.endsWith("/bogen");
  return (
    <RequireAccount>
      {() => (
        <DraftProvider draftId={id}>
          {(load) => {
            switch (load.state) {
              case "ready":
                if (isSheet) return children;
                return isEnd ? (
                  <AppShell>{children}</AppShell>
                ) : (
                  <FlowLayout current={current}>{children}</FlowLayout>
                );
              case "loading":
                return (
                  <AppShell>
                    <div className="page">
                      <Loading shape="page" count={3} />
                    </div>
                  </AppShell>
                );
              case "notFound":
              case "packageUnavailable":
                return (
                  <AppShell>
                    <div className="page">
                      <EmptyState
                        title={load.state === "notFound" ? t("flow.notFound") : t("flow.packageUnavailable")}
                      >
                        <ButtonLink href="/characters">{t("menu.characters")}</ButtonLink>
                      </EmptyState>
                    </div>
                  </AppShell>
                );
              case "helpEnded":
                return (
                  <AppShell>
                    <div className="page">
                      <EmptyState title={t("live.helpEndedTitle")}>
                        <p>{t("live.helpEndedText")}</p>
                        <ButtonLink href="/characters">{t("menu.characters")}</ButtonLink>
                      </EmptyState>
                    </div>
                  </AppShell>
                );
              case "error":
                return (
                  <AppShell>
                    <div className="page">
                      <ErrorState onRetry={load.retry} />
                    </div>
                  </AppShell>
                );
            }
          }}
        </DraftProvider>
      )}
    </RequireAccount>
  );
}
