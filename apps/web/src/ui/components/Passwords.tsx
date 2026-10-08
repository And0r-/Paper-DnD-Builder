"use client";
/**
 * The player's passwords in the settings (AND-235): the list with names and
 * dates, "New password" (a name, then the password shown once), and
 * deleting one. The last one cannot be deleted: without it, nobody gets
 * back in. Built like the access keys next to it.
 */
import { useEffect, useState } from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError, type FreshPasswordInfo, type PasswordInfo } from "../api.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog, Dialog } from "./Dialog.tsx";
import { Callout, ErrorState, Loading } from "./Feedback.tsx";
import { TextField, Toast } from "./Fields.tsx";
import { FreshPassword } from "./FreshPassword.tsx";

/** The server's limit for a name (see API.md). */
const MAX_NAME = 80;

export function Passwords() {
  const { t, lang, account } = useApp();
  const [passwords, setPasswords] = useState<PasswordInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<PasswordInfo>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    let live = true;
    api<{ passwords: PasswordInfo[] }>("GET", "/api/account/passwords").then(
      (r) => live && (setPasswords(r.passwords), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const date = new Intl.DateTimeFormat(lang, { dateStyle: "long" });
  const last = passwords?.length === 1;

  // A password without a name of its own is named here, in the screen's language, not by the server.
  const nameOf = (p: PasswordInfo) => {
    if (p.name) return p.name;
    if (p.origin === "first") return t("settings.passwordFirst");
    if (p.origin === "reset") return t("settings.passwordReset");
    const made = new Date(p.createdAt);
    const day = new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "long",
      ...(made.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    });
    return t("settings.passwordFrom", { date: day.format(made) });
  };
  // Named by its day already: the day once is enough.
  const byDay = (p: PasswordInfo) => !p.name && !p.origin;

  const close = () => {
    setMaking(false);
    setFresh(undefined);
    setName("");
  };

  async function create() {
    setError(undefined);
    setBusy(true);
    try {
      const r = await api<{ password: FreshPasswordInfo }>("POST", "/api/account/passwords", {
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      const { secret, ...made } = r.password;
      setFresh(secret);
      setPasswords((all) => [...(all ?? []), made]);
    } catch (e) {
      setMaking(false);
      setError(
        e instanceof ApiError && e.code === "tooManyPasswords"
          ? t("settings.passwordsTooMany", { max: Number(e.details["max"]) })
          : t("settings.saveError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings__section" aria-labelledby="s-passwords">
      <h2 className="section-title" id="s-passwords">
        {t("settings.passwords")}
      </h2>
      <p>{t("settings.passwordsText")}</p>
      <div aria-live="polite">
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
      </div>

      {failed && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
      {!failed && !passwords && <Loading count={1} />}
      {passwords && passwords.length > 0 && (
        <ul className="access-keys" aria-label={t("settings.passwordsListLabel")}>
          {passwords.map((p) => (
            <li className="access-keys__item" key={p.id}>
              <span className="access-keys__text">
                <span className="access-keys__name">{nameOf(p)}</span>
                {!byDay(p) && (
                  <span className="note">
                    {t("settings.keyCreated", { date: date.format(new Date(p.createdAt)) })}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                aria-label={t("settings.passwordDeleteLabel", { name: nameOf(p) })}
                disabled={last}
                onClick={() => setRemove(p)}
              >
                {t("settings.passwordDelete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {last && <p className="note">{t("settings.passwordLast")}</p>}

      <div>
        <Button variant="secondary" icon="plus" onClick={() => setMaking(true)}>
          {t("settings.passwordNew")}
        </Button>
      </div>

      <Dialog
        open={making}
        // Once the password shows, only its button closes: a stray tap beside the box must not lose it.
        onClose={fresh ? () => {} : close}
        title={fresh ? t("password.title") : t("settings.passwordNew")}
        footer={
          fresh ? undefined : (
            <>
              <Button variant="secondary" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                form="new-password"
                busy={busy}
                busyLabel={t("settings.passwordCreating")}
              >
                {t("settings.passwordCreate")}
              </Button>
            </>
          )
        }
      >
        {fresh ? (
          <FreshPassword
            secret={fresh}
            username={account?.name ?? ""}
            noMail={!account?.email}
            onDone={close}
          />
        ) : (
          <form
            id="new-password"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField
              label={t("settings.passwordName")}
              help={t("settings.passwordNameHelp")}
              value={name}
              maxLength={MAX_NAME}
              autoComplete="off"
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={remove !== undefined}
        title={t("settings.passwordDeleteTitle")}
        confirmLabel={t("settings.passwordDeleteConfirm")}
        danger
        busy={busy}
        onCancel={() => setRemove(undefined)}
        onConfirm={async () => {
          const p = remove!;
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/account/passwords/${encodeURIComponent(p.id)}`);
            setPasswords((all) => all?.filter((x) => x.id !== p.id) ?? null);
            setToast(t("settings.passwordDeleted"));
          } catch (e) {
            if (e instanceof ApiError && e.code === "passwordNotFound") {
              // Already gone (another tab): the list is right without it.
              setPasswords((all) => all?.filter((x) => x.id !== p.id) ?? null);
            } else if (e instanceof ApiError && e.code === "lastPassword") {
              setError(t("settings.passwordLast"));
              setAttempt((n) => n + 1);
            } else setError(t("settings.saveError"));
          } finally {
            setBusy(false);
            setRemove(undefined);
          }
        }}
      >
        <p>{t("settings.passwordDeleteText", { name: remove ? nameOf(remove) : "" })}</p>
      </ConfirmDialog>

      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </section>
  );
}
