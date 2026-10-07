"use client";
/**
 * Access keys in the settings, after the language model package that can
 * make one too: make one with a name saying what it is for
 * (shown once, to copy), see the list with names and dates, withdraw one. A key lets a program the player trusts work in
 * their account over the API (see API.md).
 */
import { useEffect, useState } from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError } from "../api.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./Dialog.tsx";
import { Callout, ErrorState, Loading } from "./Feedback.tsx";
import { TextField, Toast } from "./Fields.tsx";
import { FreshKey } from "./FreshKey.tsx";
import { LanguageModelHelp } from "./LanguageModelHelp.tsx";

/** The server's limit for a name (see API.md). */
const MAX_NAME = 80;

interface AccessKey {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
}

export function AccessKeys() {
  const { t, lang } = useApp();
  const [keys, setKeys] = useState<AccessKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fresh, setFresh] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState<AccessKey>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [name, setName] = useState("");
  const [nameMissing, setNameMissing] = useState(false);

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
    setError(undefined);
    if (!name.trim()) {
      setNameMissing(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ key: AccessKey & { secret: string } }>("POST", "/api/account/keys", {
        name: name.trim(),
      });
      const { secret, ...key } = r.key;
      setFresh(secret);
      setName("");
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
    <>
      {/* Above the keys: a package with a key adds one to the list below. */}
      <LanguageModelHelp onKeyMade={() => setAttempt((n) => n + 1)} />
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
          <FreshKey
            key={fresh}
            secret={fresh}
            title={t("settings.keyNewTitle")}
            label={t("settings.keyNewText")}
            onDone={() => setFresh(undefined)}
          />
        )}

        {failed && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
        {!failed && !keys && <Loading count={1} />}
        {keys && keys.length === 0 && <p className="note">{t("settings.keysNone")}</p>}
        {keys && keys.length > 0 && (
          <ul className="access-keys" aria-label={t("settings.keysListLabel")}>
            {keys.map((k) => (
              <li className="access-keys__item" key={k.id}>
                <span className="access-keys__text">
                  <span className="access-keys__name">{k.name}</span>
                  <span className="note">
                    <span className="access-keys__hint">{t("settings.keyItem", { hint: k.hint })}</span>{" "}
                    {t("settings.keyCreated", { date: date.format(new Date(k.createdAt)) })}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  aria-label={t("settings.keyRevokeLabel", { name: k.name })}
                  onClick={() => setWithdraw(k)}
                >
                  {t("settings.keyRevoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="access-keys__new"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <TextField
            label={t("settings.keyName")}
            help={t("settings.keyNameHelp")}
            error={nameMissing ? t("settings.keyNameMissing") : undefined}
            value={name}
            maxLength={MAX_NAME}
            autoComplete="off"
            onChange={(e) => {
              setName(e.currentTarget.value);
              setNameMissing(false);
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            icon="plus"
            busy={busy}
            busyLabel={t("settings.keyCreating")}
          >
            {t("settings.keyCreate")}
          </Button>
        </form>

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
          <p>{t("settings.keyRevokeText", { name: withdraw?.name ?? "", hint: withdraw?.hint ?? "" })}</p>
        </ConfirmDialog>

        {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
      </section>
    </>
  );
}
