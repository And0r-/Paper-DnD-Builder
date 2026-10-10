"use client";
/**
 * Admin: the accounts (AND-353). A search over name and address, the
 * accounts newest first, 50 to a page, and per account: make it an admin
 * or a player, log it out everywhere, delete it. Deleting asks for the
 * account's name to be typed, as deleting one's own asks for a word.
 *
 * Only what the list holds is shown: no settings, no characters, only how
 * many. The server refuses all of it to anyone but an admin in the
 * browser; the guard only spares a player the page.
 */
import { useEffect, useState, type FormEvent } from "react";
import { LANGUAGE_NAMES, isUiLanguage } from "../../../src/i18n/index.ts";
import { useApp } from "../../../src/ui/app-state.tsx";
import { api, ApiError, type AdminAccount, type AdminAccountPage } from "../../../src/ui/api.ts";
import { AdminTabs } from "../../../src/ui/components/AdminTabs.tsx";
import { Button } from "../../../src/ui/components/Button.tsx";
import { ConfirmDialog, TypedConfirmDialog } from "../../../src/ui/components/Dialog.tsx";
import { Callout, ErrorState, Loading } from "../../../src/ui/components/Feedback.tsx";
import { TextField, Toast } from "../../../src/ui/components/Fields.tsx";
import { AppShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { RequireAdmin } from "../../../src/ui/guards.tsx";

export default function AdminAccountsPage() {
  return <RequireAdmin>{() => <Accounts />}</RequireAdmin>;
}

function Accounts() {
  const app = useApp();
  const { t, tc, lang } = app;
  usePageTitle([t("admin.accountsTitle"), t("admin.title")]);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState({ q: "", page: 1 });
  const [data, setData] = useState<AdminAccountPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [loggingOut, setLoggingOut] = useState<AdminAccount>();
  const [deleting, setDeleting] = useState<AdminAccount>();

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ page: String(query.page) });
    if (query.q) params.set("q", query.q);
    api<AdminAccountPage>("GET", `/api/admin/accounts?${params}`).then(
      (r) => live && (setData(r), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [query, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });

  /** What went wrong, in words; the list is loaded again, as it may have changed meanwhile. */
  function failure(e: unknown) {
    if (e instanceof ApiError && e.code === "lastAdmin") setError(t("admin.lastAdmin"));
    else if (e instanceof ApiError && e.code === "ownAccount") setError(t("admin.ownAccount"));
    else if (e instanceof ApiError && e.code === "accountNotFound") setError(t("admin.gone"));
    else setError(t("common.loadError"));
    reload();
  }

  async function setRole(a: AdminAccount, role: AdminAccount["role"]) {
    setBusy(`role:${a.id}`);
    setError(undefined);
    try {
      await api("PATCH", `/api/admin/accounts/${a.id}/role`, { role });
      setToast(t(role === "admin" ? "admin.madeAdmin" : "admin.madePlayer", { name: a.name }));
      // Stepped down themselves: the page is no longer theirs, the guard takes them away.
      if (a.self && role === "player") await app.reloadAccount().catch(() => {});
      else reload();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(undefined);
    }
  }

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery({ q: typed.trim(), page: 1 });
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  let list;
  if (failed) list = <ErrorState message={t("admin.loadError")} onRetry={reload} />;
  else if (!data) list = <Loading shape="cards" count={2} />;
  else if (data.accounts.length === 0) list = <p>{t("admin.empty")}</p>;
  else {
    list = (
      <>
        {/* A wide table scrolls on its own on a phone; the region can be reached and scrolled with keys. */}
        <div className="admin-table" role="region" aria-labelledby="admin-caption" tabIndex={0}>
          <table>
            <caption id="admin-caption">{tc("admin.total", data.total)}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.colName")}</th>
                <th scope="col">{t("admin.colEmail")}</th>
                <th scope="col">{t("admin.colLanguage")}</th>
                <th scope="col">{t("admin.colRole")}</th>
                <th scope="col">{t("admin.colCreated")}</th>
                <th scope="col" className="admin-table__number">
                  {t("admin.colDrafts")}
                </th>
                <th scope="col" className="admin-table__number">
                  {t("admin.colCampaigns")}
                </th>
                <th scope="col">{t("admin.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.name}
                    {a.self && <span className="admin-table__you"> {t("admin.you")}</span>}
                  </th>
                  <td>{a.email ?? <span className="admin-table__none">{t("admin.noEmail")}</span>}</td>
                  <td>
                    {isUiLanguage(a.language) ? (
                      <span lang={a.language}>{LANGUAGE_NAMES[a.language]}</span>
                    ) : (
                      a.language
                    )}
                  </td>
                  <td>{t(a.role === "admin" ? "admin.roleAdmin" : "admin.rolePlayer")}</td>
                  <td>{date.format(new Date(a.createdAt))}</td>
                  <td className="admin-table__number">{a.drafts}</td>
                  <td className="admin-table__number">{a.campaigns}</td>
                  <td>
                    <div className="admin-table__actions">
                      <Button
                        variant="secondary"
                        busy={busy === `role:${a.id}`}
                        busyLabel={t("admin.saving")}
                        aria-label={t("admin.actionLabel", {
                          action: t(a.role === "admin" ? "admin.removeAdmin" : "admin.makeAdmin"),
                          name: a.name,
                        })}
                        onClick={() => void setRole(a, a.role === "admin" ? "player" : "admin")}
                      >
                        {t(a.role === "admin" ? "admin.removeAdmin" : "admin.makeAdmin")}
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={t("admin.actionLabel", { action: t("admin.logoutAll"), name: a.name })}
                        onClick={() => setLoggingOut(a)}
                      >
                        {t("admin.logoutAll")}
                      </Button>
                      {!a.self && (
                        <Button
                          variant="danger"
                          aria-label={t("admin.actionLabel", { action: t("admin.delete"), name: a.name })}
                          onClick={() => setDeleting(a)}
                        >
                          {t("admin.delete")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav className="admin-pages" aria-label={t("admin.pagesLabel")}>
            <Button
              variant="secondary"
              icon="arrowLeft"
              disabled={query.page <= 1}
              onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
            >
              {t("admin.previous")}
            </Button>
            <p aria-live="polite">{t("admin.pageOf", { page: query.page, pages })}</p>
            <Button
              variant="secondary"
              iconAfter="arrowRight"
              disabled={query.page >= pages}
              onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
            >
              {t("admin.next")}
            </Button>
          </nav>
        )}
      </>
    );
  }

  return (
    <AppShell broad>
      <div className="page admin">
        <AdminTabs current="accounts" />
        <h1 className="page__title">{t("admin.accountsTitle")}</h1>
        <form className="admin__search" role="search" noValidate onSubmit={search}>
          <TextField
            label={t("admin.searchLabel")}
            type="search"
            value={typed}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setTyped(e.currentTarget.value)}
          />
          <Button type="submit" variant="secondary">
            {t("admin.search")}
          </Button>
        </form>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
        {list}
      </div>
      <ConfirmDialog
        open={loggingOut !== undefined}
        title={t("admin.logoutAllTitle", { name: loggingOut?.name ?? "" })}
        confirmLabel={t("admin.logoutAll")}
        danger
        busy={busy === "logout"}
        onCancel={() => setLoggingOut(undefined)}
        onConfirm={async () => {
          const a = loggingOut!;
          setBusy("logout");
          setError(undefined);
          try {
            await api("POST", `/api/admin/accounts/${a.id}/logout-all`);
            setToast(t("admin.loggedOut", { name: a.name }));
            // Their own logins too: this browser is logged out now.
            if (a.self) await app.reloadAccount().catch(() => {});
          } catch (e) {
            failure(e);
          } finally {
            setBusy(undefined);
            setLoggingOut(undefined);
          }
        }}
      >
        <p>{t("admin.logoutAllText")}</p>
      </ConfirmDialog>
      <TypedConfirmDialog
        open={deleting !== undefined}
        title={t("admin.deleteTitle", { name: deleting?.name ?? "" })}
        word={deleting?.name ?? ""}
        label={t("admin.deleteTypeLabel", { name: deleting?.name ?? "" })}
        mismatch={t("admin.deleteMismatch", { name: deleting?.name ?? "" })}
        confirmLabel={t("admin.delete")}
        busy={busy === "delete"}
        onCancel={() => setDeleting(undefined)}
        onConfirm={async () => {
          const a = deleting!;
          setBusy("delete");
          setError(undefined);
          try {
            await api("DELETE", `/api/admin/accounts/${a.id}`);
            setToast(t("admin.deleted", { name: a.name }));
            reload();
          } catch (e) {
            failure(e);
          } finally {
            setBusy(undefined);
            setDeleting(undefined);
          }
        }}
      >
        <p>{t("admin.deleteText", { drafts: deleting?.drafts ?? 0 })}</p>
      </TypedConfirmDialog>
      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
