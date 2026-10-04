"use client";
/**
 * My characters (flow spec 4.2): unfinished first, each with where it
 * stands. Deleting asks first and can be undone for 10 seconds.
 */
import { evaluateDraft } from "@builder/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, type DraftListEntry } from "../../src/ui/api.ts";
import { Button, ButtonLink } from "../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../src/ui/components/Dialog.tsx";
import { EmptyState, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { Toast } from "../../src/ui/components/Fields.tsx";
import { Icon } from "../../src/ui/components/Icon.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { buildFlow, firstOpen, progressOf } from "../../src/ui/flow/model.ts";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { plain, measureContext, thingName, ptext } from "../../src/ui/package-text.ts";
import { loadPackage, type LoadedPackage } from "../../src/ui/packages.ts";

const UNDO_MS = 10_000;

type Data = { drafts: DraftListEntry[]; packages: Map<string, LoadedPackage> };

export default function CharactersPage() {
  return <RequireAccount>{() => <Characters />}</RequireAccount>;
}

function Characters() {
  const { t, lang } = useApp();
  usePageTitle([t("characters.title")]);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const hidden = useRef(new Set<string>());
  const [, rerender] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const { drafts } = await api<{ drafts: DraftListEntry[] }>("GET", "/api/drafts");
      const packages = new Map<string, LoadedPackage>();
      for (const id of new Set(drafts.filter((d) => d.packageAvailable).map((d) => d.packageId))) {
        packages.set(id, await loadPackage(id, lang));
      }
      return { drafts, packages };
    })().then(
      (d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [lang, attempt]);

  const reallyDelete = useCallback((id: string) => {
    void api("DELETE", `/api/drafts/${id}`).catch(() => {
      // Not deleted after all: show it again.
      hidden.current.delete(id);
      rerender((n) => n + 1);
    });
  }, []);

  // Leaving the page during the undo time still deletes, as promised.
  const pendingDelete = useRef<string | null>(null);
  pendingDelete.current = undo?.id ?? null;
  useEffect(() => {
    const flush = () => {
      if (pendingDelete.current) {
        void fetch(`/api/drafts/${pendingDelete.current}`, { method: "DELETE", keepalive: true });
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const startDelete = () => {
    if (!confirm) return;
    if (undo) reallyDelete(undo.id);
    hidden.current.add(confirm.id);
    setUndo(confirm);
    setConfirm(null);
  };

  let content;
  if (failed) {
    content = <ErrorState message={t("characters.loadError")} onRetry={() => setAttempt((n) => n + 1)} />;
  } else if (!data) {
    content = <Loading shape="cards" count={3} />;
  } else {
    const items = data.drafts
      .filter((d) => !hidden.current.has(d.id))
      .map((d) => describe(d, data.packages.get(d.packageId)))
      .sort((a, b) => Number(a.finished) - Number(b.finished));
    content =
      items.length === 0 ? (
        <EmptyState title={t("characters.emptyTitle")}>
          <ButtonLink href="/new" icon="plus">
            {t("characters.emptyAction")}
          </ButtonLink>
        </EmptyState>
      ) : (
        <>
          <div className="page-actions">
            <ButtonLink href="/new" icon="plus">
              {t("characters.new")}
            </ButtonLink>
          </div>
          <ul className="character-list">
            {items.map((c) => (
              <li key={c.id}>
                <CharacterCard item={c} onDelete={() => setConfirm({ id: c.id, name: c.name })} />
              </li>
            ))}
          </ul>
        </>
      );
  }

  function describe(d: DraftListEntry, lp: LoadedPackage | undefined) {
    const name = d.summary?.name || t("common.unnamed");
    if (!lp)
      return { id: d.id, name, line: "", finished: false, status: t("characters.packageMissing"), href: "" };
    const ev = evaluateDraft(lp.pkg, { level: d.level, answers: d.answers });
    const entries = buildFlow(d.id, lp, ev, t);
    const finished = d.status === "finished" && ev.complete;
    // The line only makes sense once everything it names is chosen.
    const vars: Record<string, string | number> = {};
    let whole = true;
    for (const [k, v] of Object.entries(d.summary?.line ?? {})) {
      if (v === null) whole = false;
      else vars[k] = typeof v === "string" ? thingName(lp, v) : v;
    }
    const ctx = measureContext(lp, undefined);
    const p = progressOf(entries);
    return {
      id: d.id,
      name,
      line: whole ? plain(ctx, ptext(lp, "summary.line"), vars) : "",
      finished,
      status: finished ? t("characters.finished") : t("characters.progress", p),
      href: finished ? `/c/${d.id}/overview` : firstOpen(entries).href,
      doneHref: `/c/${d.id}/done`,
    };
  }

  return (
    <AppShell>
      <div className="page">
        <h1 className="page__title">{t("characters.title")}</h1>
        {content}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={t("characters.deleteTitle", { name: confirm?.name ?? "" })}
        confirmLabel={t("characters.delete")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={startDelete}
      >
        <p>{t("characters.deleteText")}</p>
      </ConfirmDialog>
      {undo && (
        <Toast
          key={undo.id}
          message={t("characters.deleted", { name: undo.name })}
          action={t("characters.undo")}
          duration={UNDO_MS}
          onAction={() => {
            hidden.current.delete(undo.id);
            setUndo(null);
          }}
          onDone={() => {
            reallyDelete(undo.id);
            setUndo(null);
          }}
        />
      )}
    </AppShell>
  );
}

function CharacterCard({
  item,
  onDelete,
}: {
  item: {
    id: string;
    name: string;
    line: string;
    finished: boolean;
    status: string;
    href: string;
    doneHref?: string;
  };
  onDelete: () => void;
}) {
  const { t } = useApp();
  const [menu, setMenu] = useState(false);
  return (
    <article className="character">
      <div className="character__main">
        <h2 className="character__name">{item.name}</h2>
        {item.line && <p className="character__line">{item.line}</p>}
        <p className={`character__status${item.finished ? " character__status--done" : ""}`}>
          {item.finished && <Icon name="check" size={18} />}
          <span>{item.status}</span>
        </p>
      </div>
      <div className="character__actions">
        {item.href && (
          <ButtonLink href={item.href} variant={item.finished ? "secondary" : "primary"}>
            {item.finished ? t("characters.view") : t("characters.continue")}
          </ButtonLink>
        )}
        {item.finished && item.doneHref && (
          <ButtonLink href={item.doneHref} variant="secondary" icon="printer">
            {t("characters.print")}
          </ButtonLink>
        )}
        <div className="character__more">
          <button
            type="button"
            className="icon-button"
            aria-expanded={menu}
            aria-label={t("characters.more", { name: item.name })}
            onClick={() => setMenu((m) => !m)}
          >
            <Icon name="more" />
          </button>
          {menu && (
            <div className="popover">
              <Button
                variant="ghost"
                className="btn--danger-text"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                {t("characters.delete")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
