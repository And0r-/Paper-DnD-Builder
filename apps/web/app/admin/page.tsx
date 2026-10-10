"use client";
/**
 * Admin: the overview (AND-353). Numbers as tiles, accounts and characters
 * made per week as two bar charts with their table, and what the server
 * runs. "Active now" and "building now" are counts kept in the server's
 * memory, never who; the privacy page says so.
 */
import { useEffect, useState, type ReactNode } from "react";
import { LANGUAGE_NAMES, isUiLanguage } from "../../src/i18n/index.ts";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, type AdminStats } from "../../src/ui/api.ts";
import { AdminTabs } from "../../src/ui/components/AdminTabs.tsx";
import { BarChart } from "../../src/ui/components/BarChart.tsx";
import { ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAdmin } from "../../src/ui/guards.tsx";

export default function AdminPage() {
  return <RequireAdmin>{() => <Overview />}</RequireAdmin>;
}

/** A group of numbers, each a tile: its label, then the number. */
function Tiles({ title, items }: { title: string; items: [label: string, value: ReactNode][] }) {
  return (
    <section className="admin__section">
      <h2 className="section-title">{title}</h2>
      <dl className="admin-tiles">
        {items.map(([label, value]) => (
          <div key={label} className="admin-tile">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Overview() {
  const { t, lang } = useApp();
  usePageTitle([t("admin.overviewTitle"), t("admin.title")]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api<AdminStats>("GET", "/api/admin/stats").then(
      (r) => live && (setStats(r), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const n = new Intl.NumberFormat(lang);
  let body;
  if (failed) body = <ErrorState message={t("admin.statsError")} onRetry={() => setAttempt((a) => a + 1)} />;
  else if (!stats) body = <Loading shape="cards" count={3} />;
  else {
    const { accounts: a, characters: c } = stats;
    const megabytes = stats.server.databaseBytes;
    body = (
      <>
        <Tiles
          title={t("admin.now")}
          items={[
            [t("admin.activeNow"), n.format(stats.activeNow)],
            [t("admin.buildingNow"), n.format(stats.buildingNow)],
          ]}
        />
        <Tiles
          title={t("admin.accountsTitle")}
          items={[
            [t("admin.accountsTotal"), n.format(a.total)],
            [t("admin.withEmail"), n.format(a.withEmail)],
            [t("admin.withoutEmail"), n.format(a.withoutEmail)],
            [t("admin.newToday"), n.format(a.newToday)],
            [t("admin.new7Days"), n.format(a.new7Days)],
            [t("admin.new30Days"), n.format(a.new30Days)],
            [t("admin.withoutCharacters"), n.format(a.withoutCharacters)],
          ]}
        />
        <Tiles
          title={t("admin.colDrafts")}
          items={[
            [t("admin.charactersTotal"), n.format(c.total)],
            [t("admin.finished"), n.format(c.finished)],
            [t("admin.new7Days"), n.format(c.new7Days)],
            [t("admin.new30Days"), n.format(c.new30Days)],
          ]}
        />
        <Tiles
          title={t("admin.campaignsAndKeys")}
          items={[
            [t("admin.colCampaigns"), n.format(stats.campaigns.total)],
            [t("admin.campaignPlayers"), n.format(stats.campaigns.players)],
            [t("admin.accessKeys"), n.format(stats.accessKeys)],
          ]}
        />
        <div className="admin__lists">
          <section className="admin__section">
            <h2 className="section-title">{t("admin.byPackage")}</h2>
            {c.byPackage.length === 0 ? (
              <p>{t("admin.none")}</p>
            ) : (
              <ul className="admin-counts">
                {c.byPackage.map((p) => (
                  <li key={p.packageId}>
                    <span>{p.packageId}</span> <span>{n.format(p.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="admin__section">
            <h2 className="section-title">{t("admin.byLanguage")}</h2>
            <ul className="admin-counts">
              {a.byLanguage.map((l) => (
                <li key={l.language}>
                  {isUiLanguage(l.language) ? (
                    <span lang={l.language}>{LANGUAGE_NAMES[l.language]}</span>
                  ) : (
                    <span>{l.language}</span>
                  )}{" "}
                  <span>{n.format(l.count)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <BarChart title={t("admin.accountsPerWeek")} data={stats.accountsPerWeek} />
        <BarChart title={t("admin.draftsPerWeek")} data={stats.draftsPerWeek} />
        <section className="admin__section">
          <h2 className="section-title">{t("admin.server")}</h2>
          <dl className="admin-facts">
            <dt>{t("admin.packages")}</dt>
            <dd>
              {stats.server.packages.length === 0
                ? t("admin.none")
                : stats.server.packages.map((p) => `${p.id} ${p.version}`).join(", ")}
            </dd>
            <dt>{t("admin.databaseSize")}</dt>
            <dd>
              {megabytes === null
                ? t("admin.unknown")
                : t("admin.megabytes", {
                    size: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(megabytes / 1e6),
                  })}
            </dd>
            <dt>{t("admin.startedAt")}</dt>
            <dd>
              {new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(stats.server.startedAt),
              )}
            </dd>
          </dl>
        </section>
      </>
    );
  }

  return (
    <AppShell>
      <div className="page admin">
        <AdminTabs current="overview" />
        <h1 className="page__title">{t("admin.overviewTitle")}</h1>
        {body}
      </div>
    </AppShell>
  );
}
