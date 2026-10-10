"use client";
/** The admin's pages, "Overview | Accounts | Feedback", above each of them; the open one is marked. */
import Link from "next/link";
import { useApp } from "../app-state.tsx";

export function AdminTabs({ current }: { current: "overview" | "accounts" | "feedback" }) {
  const { t } = useApp();
  const tabs = [
    { id: "overview", href: "/admin", label: t("admin.overviewTitle") },
    { id: "accounts", href: "/admin/accounts", label: t("admin.accountsTitle") },
    { id: "feedback", href: "/admin/feedback", label: t("admin.feedbackTitle") },
  ] as const;
  return (
    <nav className="admin-tabs" aria-label={t("admin.title")}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link href={tab.href} aria-current={tab.id === current ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
