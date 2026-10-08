"use client";
/**
 * Login (AND-235): no mail on the way in.
 *
 * - "Get started": a name and, if wanted, a mail address (only a way back
 *   in). The server makes the account and its password; the player sees
 *   the password once and is in.
 * - "Log in": the password alone.
 * - "Account from before": mail address and the password that used to be
 *   mailed, once; it is swapped for a new password, shown like a new one.
 * - "Lost your password?" (AND-236): a link by mail to the address of the
 *   account, which shows a new password (`login/reset/[token]`). Opened
 *   with `?lost`, from a link that no longer works.
 *
 * `?login` opens "Log in" first. `?next=/join/<token>`: where to go once logged in, instead of the
 * character list (from an invitation, AND-237). Only a path on this site.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type Account, type FreshPasswordInfo } from "../../src/ui/api.ts";
import { Button } from "../../src/ui/components/Button.tsx";
import { Callout } from "../../src/ui/components/Feedback.tsx";
import { Explained } from "../../src/ui/components/Explained.tsx";
import { TextField } from "../../src/ui/components/Fields.tsx";
import { FreshPassword } from "../../src/ui/components/FreshPassword.tsx";
import { GetStarted, MAIL } from "../../src/ui/components/GetStarted.tsx";
import { GuestShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RESEND_AFTER_S, resetLinkError, sendResetLink } from "../../src/ui/reset-link.ts";

type Mode = "start" | "login" | "legacy" | "lost" | "sent";

/** `?next`, if it is a path on this site (not `//elsewhere`), else the character list. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && /^\/(?![/\\])/.test(next) ? next : "/characters";
}

export default function LoginPage() {
  const app = useApp();
  const { t, tc, lang, account } = app;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("start");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  // When the last link was sent, and a clock for the wait before "Send again".
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [resent, setResent] = useState(false);
  // A password just made: shown until the player says they have it. The
  // account is taken over only then, so nothing moves on before.
  const [fresh, setFresh] = useState<{ account: Account; secret: string }>();
  const emailRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const passwordRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  usePageTitle([
    fresh
      ? t("password.title")
      : mode === "login"
        ? t("login.haveTitle")
        : mode === "legacy"
          ? t("login.legacyTitle")
          : mode === "lost"
            ? t("login.lostTitle")
            : mode === "sent"
              ? t("login.sentTitle")
              : t("login.title"),
  ]);

  // From "Ask for a new link" on a link that no longer works; from "I already have a password" on an invitation.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("lost")) setMode("lost");
    else if (query.has("login")) setMode("login");
  }, []);

  useEffect(() => {
    if (mode !== "sent") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (account && !fresh) router.replace(nextPath());
  }, [account, fresh, router]);

  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus());

  const go = (m: Mode) => {
    setMode(m);
    setFormError(undefined);
    setPasswordError(undefined);
    setEmailError(undefined);
    setPassword("");
    setResent(false);
    focusHeading();
  };

  const minutes = (e: ApiError) => Math.max(1, Math.ceil((e.retryAfter ?? 300) / 60));

  const failure = (error: unknown) => (error instanceof ApiError ? error : new ApiError(0, "network"));

  const checkEmail = (required: boolean): boolean => {
    const value = email.trim();
    const ok = value ? MAIL.test(value) : !required;
    setEmailError(ok ? undefined : t("login.emailInvalid"));
    if (!ok) emailRef.current?.focus();
    return ok;
  };

  const checkPassword = (): boolean => {
    if (password.trim()) return true;
    setPasswordError(t("login.passwordMissing"));
    passwordRef.current?.focus();
    return false;
  };

  const showFresh = (r: { account: Account; password: FreshPasswordInfo }) => {
    setFresh({ account: r.account, secret: r.password.secret });
    setPassword("");
    focusHeading();
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!checkPassword()) return;
    setFormError(undefined);
    setPasswordError(undefined);
    setBusy(true);
    try {
      const r = await api<{ account: Account }>("POST", "/api/auth/login", { password: password.trim() });
      app.setAccount(r.account);
      router.replace(nextPath());
    } catch (error) {
      const err = failure(error);
      if (err.status === 401 || err.status === 400) {
        setPasswordError(t("login.wrongPassword"));
        passwordRef.current?.focus();
      } else if (err.status === 429) setFormError(tc("login.tooMany", minutes(err)));
      else if (err.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
  };

  const onLegacy = async (e: FormEvent) => {
    e.preventDefault();
    if (!checkEmail(true) || !checkPassword()) return;
    setFormError(undefined);
    setPasswordError(undefined);
    setBusy(true);
    try {
      showFresh(
        await api<{ account: Account; password: FreshPasswordInfo }>("POST", "/api/auth/legacy-login", {
          email: email.trim(),
          password: password.trim(),
        }),
      );
    } catch (error) {
      const err = failure(error);
      if (err.status === 401 || err.status === 400) {
        setPasswordError(t("login.legacyWrong"));
        passwordRef.current?.focus();
      } else if (err.status === 429) setFormError(tc("login.tooMany", minutes(err)));
      else if (err.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
  };

  const requestLink = async (): Promise<boolean> => {
    setFormError(undefined);
    setBusy(true);
    try {
      await sendResetLink(email.trim(), lang);
      setSentAt(Date.now());
      setNow(Date.now());
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setEmailError(t("login.emailInvalid"));
        emailRef.current?.focus();
      } else setFormError(resetLinkError(error, app));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onLost = async (e: FormEvent) => {
    e.preventDefault();
    if (!checkEmail(true)) return;
    if (await requestLink()) go("sent");
  };

  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  const emailField = (label: string, help?: string) => (
    <TextField
      ref={emailRef}
      label={label}
      help={help}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
      value={email}
      error={emailError}
      onChange={(e) => {
        setEmail(e.target.value);
        if (emailError) setEmailError(undefined);
      }}
      onBlur={() => email.trim() && !MAIL.test(email.trim()) && setEmailError(t("login.emailInvalid"))}
    />
  );

  const passwordField = (label: string) => (
    <TextField
      ref={passwordRef}
      label={label}
      type={visible ? "text" : "password"}
      autoComplete="current-password"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className="field--password"
      value={password}
      error={passwordError}
      onChange={(e) => {
        setPassword(e.target.value);
        setPasswordError(undefined);
      }}
      trailing={
        <Button variant="ghost" onClick={() => setVisible((v) => !v)} aria-pressed={!visible}>
          {visible ? t("login.hide") : t("login.show")}
        </Button>
      }
    />
  );

  const errorBox = formError && (
    <Callout tone="danger" role="alert">
      {formError}
    </Callout>
  );

  return (
    <GuestShell>
      <div className="auth">
        {/* The name explains itself where it is seen first, as in the top bar after login (AND-90). */}
        <p className="auth__brand">
          <Explained hint={t("app.about")}>
            <span>{t("app.name")}</span>
          </Explained>
        </p>

        {fresh ? (
          <section className="auth__card" aria-labelledby="fresh-title">
            <h1 className="auth__title" id="fresh-title" tabIndex={-1} ref={headingRef}>
              {t("password.welcome", { name: fresh.account.name })}
            </h1>
            <FreshPassword
              secret={fresh.secret}
              onDone={() => {
                app.setAccount(fresh.account);
                router.replace(nextPath());
              }}
            />
          </section>
        ) : mode === "start" ? (
          <GetStarted
            title={t("login.title")}
            intro={t("login.intro")}
            headingRef={headingRef}
            onStarted={showFresh}
            footer={
              <p className="auth__switch">
                <button type="button" className="link-button" onClick={() => go("login")}>
                  {t("login.havePassword")}
                </button>
              </p>
            }
          />
        ) : mode === "login" ? (
          <form className="auth__card" onSubmit={onLogin} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.haveTitle")}
            </h1>
            <p className="auth__intro">{t("login.haveIntro")}</p>
            {passwordField(t("login.passwordLabel"))}
            <p className="auth__small">
              <button type="button" className="link-button" onClick={() => go("lost")}>
                {t("login.lost")}
              </button>
            </p>
            {errorBox}
            <Button type="submit" block busy={busy} busyLabel={t("login.submitting")}>
              {t("login.submit")}
            </Button>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("start")}>
                {t("login.needPassword")}
              </button>
            </p>
            <p className="auth__switch auth__small">
              <button type="button" className="link-button" onClick={() => go("legacy")}>
                {t("login.legacy")}
              </button>
            </p>
          </form>
        ) : mode === "lost" ? (
          <form className="auth__card" onSubmit={onLost} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.lostTitle")}
            </h1>
            <p className="auth__intro">{t("login.lostIntro")}</p>
            {emailField(t("login.lostEmailLabel"))}
            {errorBox}
            <Button type="submit" block busy={busy} busyLabel={t("login.lostSending")}>
              {t("login.lostSend")}
            </Button>
            <p className="auth__small">{t("login.lostNoMail")}</p>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("login")}>
                {t("login.toLogin")}
              </button>
            </p>
          </form>
        ) : mode === "sent" ? (
          <section className="auth__card" aria-labelledby="sent-title">
            <h1 className="auth__title" id="sent-title" tabIndex={-1} ref={headingRef}>
              {t("login.sentTitle")}
            </h1>
            <p className="auth__intro">{t("login.sent")}</p>
            {errorBox}
            <Button
              variant="secondary"
              block
              busy={busy}
              busyLabel={t("login.lostSending")}
              aria-disabled={wait > 0 || undefined}
              onClick={async () => {
                if (wait > 0) return;
                setResent(false);
                if (await requestLink()) setResent(true);
              }}
            >
              {wait > 0 ? t("login.resendIn", { seconds: wait }) : t("login.resend")}
            </Button>
            <p aria-live="polite" className="auth__small">
              {resent ? t("login.resent") : ""}
            </p>
            <p className="auth__small">{t("login.lostNoMail")}</p>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("login")}>
                {t("login.toLogin")}
              </button>
            </p>
          </section>
        ) : (
          <form className="auth__card" onSubmit={onLegacy} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.legacyTitle")}
            </h1>
            <p className="auth__intro">{t("login.legacyIntro")}</p>
            {emailField(t("login.legacyEmailLabel"))}
            {passwordField(t("login.legacyPasswordLabel"))}
            {errorBox}
            <Button type="submit" block busy={busy} busyLabel={t("login.submitting")}>
              {t("login.submit")}
            </Button>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("login")}>
                {t("login.toLogin")}
              </button>
            </p>
          </form>
        )}
      </div>
    </GuestShell>
  );
}
