"use client";
/**
 * My characters (flow spec 4.2): unfinished first, each with where it
 * stands and the campaign it is in. Deleting asks first and can be undone
 * for 10 seconds.
 *
 * An account without a mail address is reminded to add one: it is the only
 * way back in once every password is lost (AND-241). "Later" ends that for
 * good, on the account, so no other device asks again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, type Account, type Campaign, type DraftListEntry } from "../../src/ui/api.ts";
import { Button, ButtonLink } from "../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../src/ui/components/Dialog.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { Toast } from "../../src/ui/components/Fields.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { CharacterCard, describeCharacter, packagesFor } from "../../src/ui/characters.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { clearFlash, peekFlash } from "../../src/ui/live/flash.ts";
import { draftPackageKey, type LoadedPackage } from "../../src/ui/packages.ts";

const UNDO_MS = 10_000;

type Data = {
  lang: string;
  drafts: DraftListEntry[];
  packages: Map<string, LoadedPackage>;
  /** Campaign names by id; empty if they could not be loaded (the cards then just do not say). */
  campaigns: Map<string, string>;
};

export default function CharactersPage() {
  return <RequireAccount>{() => <Characters />}</RequireAccount>;
}

function Characters() {
  const app = useApp();
  const { t, lang, account } = app;
  usePageTitle([t("characters.title")]);
  const [loaded, setData] = useState<Data | null>(null);
  // Never show package words of the previous language.
  const data = loaded?.lang === lang ? loaded : null;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const hidden = useRef(new Set<string>());
  const [, rerender] = useState(0);
  // Sent here because the open character was deleted elsewhere: say so once.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => setFlash(peekFlash()), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ drafts }, campaigns] = await Promise.all([
        api<{ drafts: DraftListEntry[] }>("GET", "/api/drafts"),
        api<{ campaigns: Campaign[] }>("GET", "/api/campaigns").then(
          (r) => new Map(r.campaigns.map((c) => [c.id, c.name])),
          () => new Map<string, string>(),
        ),
      ]);
      return { lang, drafts, packages: await packagesFor(drafts, lang), campaigns };
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
      .map((d) => ({
        ...describeCharacter(d, data.packages.get(draftPackageKey(d)), t),
        campaign: d.campaignId ? data.campaigns.get(d.campaignId) : undefined,
      }))
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

  return (
    <AppShell>
      <div className="page">
        <h1 className="page__title">{t("characters.title")}</h1>
        {account?.mailReminder && (
          <Callout tone="warning">
            <p>{t("characters.mailReminder")}</p>
            <div className="callout__actions">
              <ButtonLink href="/settings" variant="secondary">
                {t("characters.mailReminderAction")}
              </ButtonLink>
              <Button
                variant="ghost"
                onClick={() => {
                  // Gone at once; kept on the account, so it stays gone elsewhere too.
                  app.setAccount({ ...account, mailReminder: false });
                  void api<{ account: Account }>("PATCH", "/api/account/settings", {
                    mailReminder: false,
                  }).then(
                    (r) => app.setAccount(r.account),
                    () => undefined,
                  );
                }}
              >
                {t("characters.mailReminderLater")}
              </Button>
            </div>
          </Callout>
        )}
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
      {flash && !undo && (
        <Toast
          message={flash}
          duration={8000}
          onDone={() => {
            clearFlash();
            setFlash(null);
          }}
        />
      )}
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
