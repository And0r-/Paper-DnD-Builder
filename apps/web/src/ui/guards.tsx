"use client";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApp } from "./app-state.tsx";
import type { Account } from "./api.ts";
import { ErrorState, Loading } from "./components/Feedback.tsx";
import { AppShell } from "./components/Shell.tsx";

/** Renders its children only for a logged-in player; everyone else goes to the login screen. */
export function RequireAccount({ children }: { children: (account: Account) => ReactNode }) {
  const { account, accountError, reloadAccount } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (account === null) router.replace("/login");
  }, [account, router]);
  if (account) return <>{children(account)}</>;
  if (accountError) {
    return (
      <AppShell>
        <ErrorState onRetry={() => void reloadAccount().catch(() => {})} />
      </AppShell>
    );
  }
  return (
    <div className="page-loading">
      <Loading shape="page" count={2} />
    </div>
  );
}
