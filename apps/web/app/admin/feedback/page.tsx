"use client";
/**
 * Admin: the players' feedback (AND-354). Newest first, 50 to a page,
 * filtered by status (open by default) and kind. Each one as a card: when,
 * from whom (or a deleted account), kind, rating, page, the text with its
 * line breaks; marked done or open again, or deleted.
 *
 * The server refuses all of it to anyone but an admin in the browser; the
 * guard only spares a player the page.
 */
import { useEffect, useId, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import {
  api,
  ApiError,
  type AdminFeedback,
  type AdminFeedbackPage,
  type FeedbackKind,
} from "../../../src/ui/api.ts";
import { AdminTabs } from "../../../src/ui/components/AdminTabs.tsx";
import { Button } from "../../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../../src/ui/components/Dialog.tsx";
import { Callout, ErrorState, Loading } from "../../../src/ui/components/Feedback.tsx";
import { Segmented, SelectField, Toast } from "../../../src/ui/components/Fields.tsx";
import { AppShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { RequireAdmin } from "../../../src/ui/guards.tsx";

type StatusFilter = "open" | "done" | "all";
type KindFilter = FeedbackKind | "all";

const KIND_KEYS = {
  wrong: "feedback.kindWrong",
  idea: "feedback.kindIdea",
  other: "feedback.kindOther",
} as const;

export default function AdminFeedbackPage() {
  return <RequireAdmin>{() => <FeedbackList />}</RequireAdmin>;
}

function FeedbackList() {
  const { t, tc, lang } = useApp();
  usePageTitle([t("admin.feedbackTitle"), t("admin.title")]);
  const captionId = useId();
  const [query, setQuery] = useState<{ status: StatusFilter; kind: KindFilter; page: number }>({
    status: "open",
    kind: "all",
    page: 1,
  });
  const [data, setData] = useState<AdminFeedbackPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [deleting, setDeleting] = useState<AdminFeedback>();

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ page: String(query.page) });
    if (query.status !== "all") params.set("status", query.status);
    if (query.kind !== "all") params.set("kind", query.kind);
    api<AdminFeedbackPage>("GET", `/api/admin/feedback?${params}`).then(
      (r) => live && (setData(r), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [query, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  const who = (f: AdminFeedback) => f.account?.name ?? t("admin.feedbackDeletedAccount");
  const itemLabel = (f: AdminFeedback) =>
    t("admin.feedbackItemLabel", { name: who(f), date: date.format(new Date(f.createdAt)) });

  /** What went wrong, in words; the list is loaded again, as it may have changed meanwhile. */
  function failure(e: unknown) {
    if (e instanceof ApiError && e.code === "feedbackNotFound") setError(t("admin.feedbackGone"));
    else setError(t("common.loadError"));
    reload();
  }

  async function setStatus(f: AdminFeedback, status: AdminFeedback["status"]) {
    setBusy(`status:${f.id}`);
    setError(undefined);
    try {
      await api("PATCH", `/api/admin/feedback/${f.id}/status`, { status });
      setToast(t(status === "done" ? "admin.feedbackMarkedDone" : "admin.feedbackReopened"));
      reload();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(undefined);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  let list;
  if (failed) list = <ErrorState message={t("admin.feedbackLoadError")} onRetry={reload} />;
  else if (!data) list = <Loading shape="cards" count={2} />;
  else if (data.feedback.length === 0)
    list = (
      <p>
        {query.status === "open" && query.kind === "all"
          ? t("admin.feedbackEmpty")
          : t("admin.feedbackEmptyFiltered")}
      </p>
    );
  else {
    list = (
      <>
        <p id={captionId} className="admin-feedback__total">
          {tc("admin.feedbackTotal", data.total)}
        </p>
        <ul className="admin-feedback" aria-labelledby={captionId}>
          {data.feedback.map((f) => (
            <li key={f.id} className="admin-feedback__item">
              <article aria-label={itemLabel(f)}>
                <dl className="admin-feedback__facts">
                  <div>
                    <dt>{t("admin.colCreated")}</dt>
                    <dd>{date.format(new Date(f.createdAt))}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.colName")}</dt>
                    <dd>
                      {f.account ? (
                        f.account.name
                      ) : (
                        <span className="admin-table__none">{t("admin.feedbackDeletedAccount")}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("admin.feedbackKind")}</dt>
                    <dd>{t(KIND_KEYS[f.kind])}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.feedbackRating")}</dt>
                    <dd>
                      {f.rating === null
                        ? t("admin.feedbackNoRating")
                        : t("admin.feedbackRatingValue", { rating: f.rating })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("admin.feedbackPage")}</dt>
                    <dd>{f.page ? <code>{f.page}</code> : t("admin.feedbackNoPage")}</dd>
                  </div>
                  <div>
                    <dt>{t("admin.feedbackStatus")}</dt>
                    <dd>
                      {t(f.status === "done" ? "admin.feedbackStatusDone" : "admin.feedbackStatusOpen")}
                    </dd>
                  </div>
                </dl>
                <p className="admin-feedback__text">{f.text}</p>
                <div className="admin-feedback__actions">
                  <Button
                    variant="secondary"
                    icon={f.status === "open" ? "check" : "refresh"}
                    busy={busy === `status:${f.id}`}
                    busyLabel={t("admin.saving")}
                    aria-label={t("admin.actionLabel", {
                      action: t(f.status === "open" ? "admin.feedbackMarkDone" : "admin.feedbackReopen"),
                      name: itemLabel(f),
                    })}
                    onClick={() => void setStatus(f, f.status === "open" ? "done" : "open")}
                  >
                    {t(f.status === "open" ? "admin.feedbackMarkDone" : "admin.feedbackReopen")}
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={t("admin.actionLabel", {
                      action: t("admin.feedbackDelete"),
                      name: itemLabel(f),
                    })}
                    onClick={() => setDeleting(f)}
                  >
                    {t("admin.feedbackDelete")}
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
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
        <AdminTabs current="feedback" />
        <h1 className="page__title">{t("admin.feedbackTitle")}</h1>
        <div className="admin-feedback__filters">
          <Segmented<StatusFilter>
            legend={t("admin.feedbackStatus")}
            options={[
              { value: "open", label: t("admin.feedbackStatusOpen") },
              { value: "done", label: t("admin.feedbackStatusDone") },
              { value: "all", label: t("admin.feedbackStatusAll") },
            ]}
            value={query.status}
            onChange={(status) => setQuery((q) => ({ ...q, status, page: 1 }))}
          />
          <SelectField
            label={t("admin.feedbackKind")}
            value={query.kind}
            options={[
              { value: "all", label: t("admin.feedbackKindAll") },
              { value: "wrong", label: t("feedback.kindWrong") },
              { value: "idea", label: t("feedback.kindIdea") },
              { value: "other", label: t("feedback.kindOther") },
            ]}
            onChange={(kind) => setQuery((q) => ({ ...q, kind: kind as KindFilter, page: 1 }))}
          />
        </div>
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
        open={deleting !== undefined}
        title={t("admin.feedbackDeleteTitle")}
        confirmLabel={t("admin.feedbackDelete")}
        danger
        busy={busy === "delete"}
        onCancel={() => setDeleting(undefined)}
        onConfirm={async () => {
          const f = deleting!;
          setBusy("delete");
          setError(undefined);
          try {
            await api("DELETE", `/api/admin/feedback/${f.id}`);
            setToast(t("admin.feedbackDeleted"));
            reload();
          } catch (e) {
            failure(e);
          } finally {
            setBusy(undefined);
            setDeleting(undefined);
          }
        }}
      >
        <p>{t("admin.feedbackDeleteText")}</p>
      </ConfirmDialog>
      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
