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

/**
 * Renders its children only for an admin; a player goes to the start page.
 * The server checks again on every admin route: this only spares a player
 * a page that would load nothing.
 */
export function RequireAdmin({ children }: { children: (account: Account) => ReactNode }) {
  return <RequireAccount>{(account) => <AdminOnly account={account}>{children}</AdminOnly>}</RequireAccount>;
}

function AdminOnly({ account, children }: { account: Account; children: (account: Account) => ReactNode }) {
  const router = useRouter();
  const admin = account.role === "admin";
  useEffect(() => {
    if (!admin) router.replace("/");
  }, [admin, router]);
  if (admin) return <>{children(account)}</>;
  return (
    <div className="page-loading">
      <Loading shape="page" count={2} />
    </div>
  );
}
