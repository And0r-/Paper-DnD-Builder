"use client";
/**
 * Access keys in the settings: make one (shown once, to copy), see the list
 * with dates, withdraw one. A key lets a program the player trusts work in
 * their account over the API (see API.md).
 */
import { useEffect, useId, useState } from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError } from "../api.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./Dialog.tsx";
import { Callout, ErrorState, Loading } from "./Feedback.tsx";
import { Toast } from "./Fields.tsx";

interface AccessKey {
  id: string;
  hint: string;
  createdAt: string;
}

export function AccessKeys() {
  const { t, lang } = useApp();
  const [keys, setKeys] = useState<AccessKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fresh, setFresh] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<AccessKey>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const inputId = useId();

  useEffect(() => {
    let live = true;
    api<{ keys: AccessKey[] }>("GET", "/api/account/keys").then(
      (r) => live && (setKeys(r.keys), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const date = new Intl.DateTimeFormat(lang, { dateStyle: "long" });

  async function create() {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      const r = await api<{ key: AccessKey & { secret: string } }>("POST", "/api/account/keys", {});
      const { secret, ...key } = r.key;
      setFresh(secret);
      setKeys((k) => [...(k ?? []), key]);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "tooManyKeys"
          ? t("settings.keysTooMany", { max: Number(e.details["max"]) })
          : t("settings.saveError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings__section" aria-labelledby="s-keys">
      <h2 className="section-title" id="s-keys">
        {t("settings.keys")}
      </h2>
      <p>{t("settings.keysText")}</p>
      <div aria-live="polite">
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
      </div>

      {fresh && (
        <Callout tone="warning" title={t("settings.keyNewTitle")}>
          <div className="field">
            <label className="field__label" htmlFor={inputId}>
              {t("settings.keyNewText")}
            </label>
            <div className="field__row">
              <input
                id={inputId}
                className="field__input access-keys__secret"
                readOnly
                value={fresh}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="secondary"
                {...(copied ? { icon: "check" as const } : {})}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh);
                    setCopied(true);
                  } catch {
                    // No clipboard (plain HTTP): the key is selected for copying by hand.
                    document.getElementById(inputId)?.focus();
                  }
                }}
              >
                {copied ? t("settings.keyCopied") : t("settings.keyCopy")}
              </Button>
            </div>
          </div>
          <Button variant="ghost" onClick={() => setFresh(undefined)}>
            {t("settings.keyDone")}
          </Button>
        </Callout>
      )}

      {failed && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
      {!failed && !keys && <Loading count={1} />}
      {keys && keys.length === 0 && <p className="note">{t("settings.keysNone")}</p>}
      {keys && keys.length > 0 && (
        <ul className="access-keys" aria-label={t("settings.keysListLabel")}>
          {keys.map((k) => (
            <li className="access-keys__item" key={k.id}>
              <span>
                <span className="access-keys__hint">{t("settings.keyItem", { hint: k.hint })}</span>{" "}
                <span className="note">
                  {t("settings.keyCreated", { date: date.format(new Date(k.createdAt)) })}
                </span>
              </span>
              <Button
                variant="ghost"
                aria-label={t("settings.keyRevokeLabel", { hint: k.hint })}
                onClick={() => setWithdraw(k)}
              >
                {t("settings.keyRevoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        icon="plus"
        busy={busy}
        busyLabel={t("settings.keyCreating")}
        onClick={create}
      >
        {t("settings.keyCreate")}
      </Button>

      <ConfirmDialog
        open={withdraw !== undefined}
        title={t("settings.keyRevokeTitle")}
        confirmLabel={t("settings.keyRevokeConfirm")}
        danger
        busy={busy}
        onCancel={() => setWithdraw(undefined)}
        onConfirm={async () => {
          const k = withdraw!;
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/account/keys/${encodeURIComponent(k.id)}`);
            setKeys((all) => all?.filter((x) => x.id !== k.id) ?? null);
            setToast(t("settings.keyRevoked"));
          } catch (e) {
            // Already gone (another tab): the list is right without it.
            if (e instanceof ApiError && e.code === "keyNotFound") {
              setKeys((all) => all?.filter((x) => x.id !== k.id) ?? null);
            } else setError(t("settings.saveError"));
          } finally {
            setBusy(false);
            setWithdraw(undefined);
          }
        }}
      >
        <p>{t("settings.keyRevokeText", { hint: withdraw?.hint ?? "" })}</p>
      </ConfirmDialog>

      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </section>
  );
}
