"use client";
/**
 * Login (AND-235, AND-241): no mail on the way in. One page, two forms:
 *
 * - "Log in": name or mail address, and a password, for every account.
 *   An account from before logs in with its address and its old password,
 *   once; it gets a new password then, shown like a new one.
 * - "Register": a name and, if wanted, a mail address (only a way back
 *   in). The server makes the account and its password; the player sees
 *   the password once and is in.
 *
 * Side by side on a wide screen, "Log in" first on a phone. Logging out
 * lands here, and so does a new device.
 *
 * "Lost your password?" (AND-236): a link by mail to the address of the
 * account, which shows a new password (`login/reset/[token]`). Opened
 * with `?lost`, from a link that no longer works.
 *
 * `?next=/join/<token>`: where to go once logged in, instead of the
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

type Mode = "pair" | "lost" | "sent";

/** `?next`, if it is a path on this site (not `//elsewhere`), else the character list. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && /^\/(?![/\\])/.test(next) ? next : "/characters";
}

export default function LoginPage() {
  const app = useApp();
  const { t, tc, lang, account } = app;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("pair");
  const [who, setWho] = useState("");
  const [whoError, setWhoError] = useState<string>();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  // Starts hidden, so the browser's password manager fills it in.
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  // When the last link was sent, and a clock for the wait before "Send again".
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [resent, setResent] = useState(false);
  // A password just made for an account from before: shown until the
  // player says they have it. The account is taken over only then, so
  // nothing moves on before.
  const [fresh, setFresh] = useState<{ account: Account; secret: string }>();
  // Registered: the password shows in the register form itself, which stays in its place (GetStarted).
  const [registered, setRegistered] = useState(false);
  const whoRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const passwordRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  usePageTitle([
    fresh || registered
      ? t("password.title")
      : mode === "lost"
        ? t("login.lostTitle")
        : mode === "sent"
          ? t("login.sentTitle")
          : t("login.haveTitle"),
  ]);

  // From "Ask for a new link" on a link that no longer works.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("lost")) setMode("lost");
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
    setWhoError(undefined);
    setEmailError(undefined);
    setPassword("");
    setResent(false);
    focusHeading();
  };

  const minutes = (e: ApiError) => Math.max(1, Math.ceil((e.retryAfter ?? 300) / 60));

  const failure = (error: unknown) => (error instanceof ApiError ? error : new ApiError(0, "network"));

  const checkEmail = (): boolean => {
    const ok = MAIL.test(email.trim());
    setEmailError(ok ? undefined : t("login.emailInvalid"));
    if (!ok) emailRef.current?.focus();
    return ok;
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!who.trim()) {
      setWhoError(t("login.whoMissing"));
      whoRef.current?.focus();
      return;
    }
    if (!password.trim()) {
      setPasswordError(t("login.passwordMissing"));
      passwordRef.current?.focus();
      return;
    }
    setFormError(undefined);
    setPasswordError(undefined);
    setBusy(true);
    try {
      const r = await api<{ account: Account; password?: FreshPasswordInfo }>("POST", "/api/auth/login", {
        login: who.trim(),
        password: password.trim(),
      });
      if (r.password) {
        // An account from before: its old password was swapped for this one.
        setFresh({ account: r.account, secret: r.password.secret });
        setPassword("");
        focusHeading();
      } else {
        app.setAccount(r.account);
        router.replace(nextPath());
      }
    } catch (error) {
      const err = failure(error);
      if (err.status === 401 || err.status === 400) {
        setPasswordError(t("login.wrong"));
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
    if (!checkEmail()) return;
    if (await requestLink()) go("sent");
  };

  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  const errorBox = formError && (
    <Callout tone="danger" role="alert">
      {formError}
    </Callout>
  );

  const loginForm = (
    <form className="auth__card" onSubmit={onLogin} noValidate aria-labelledby="login-title">
      <h2 className="auth__title" id="login-title">
        {t("login.haveTitle")}
      </h2>
      <TextField
        ref={whoRef}
        label={t("login.whoLabel")}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={who}
        error={whoError}
        onChange={(e) => {
          setWho(e.target.value);
          setWhoError(undefined);
          setPasswordError(undefined);
        }}
      />
      <TextField
        ref={passwordRef}
        label={t("login.passwordLabel")}
        help={t("login.passwordHelp")}
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
      />
      <p className="auth__small auth__toggle">
        <button
          type="button"
          className="link-button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
        >
          {visible ? t("login.hide") : t("login.show")}
        </button>
      </p>
      {errorBox}
      <Button type="submit" block busy={busy} busyLabel={t("login.submitting")}>
        {t("login.submit")}
      </Button>
      <p className="auth__switch auth__small">
        <button type="button" className="link-button" onClick={() => go("lost")}>
          {t("login.lost")}
        </button>
      </p>
    </form>
  );

  return (
    <GuestShell>
      <div className={`auth${!fresh && !registered && mode === "pair" ? " auth--pair" : ""}`}>
        {/* The name explains itself where it is seen first, as in the top bar after login (AND-90). */}
        <p className="auth__brand">
          <Explained hint={t("app.about")}>
            <span>{t("app.name")}</span>
          </Explained>
        </p>

        {fresh ? (
          <section className="auth__card" aria-labelledby="fresh-title">
            <h1 className="auth__title" id="fresh-title" tabIndex={-1} ref={headingRef}>
              {t("password.welcomeBack", { name: fresh.account.name })}
            </h1>
            <FreshPassword
              secret={fresh.secret}
              username={fresh.account.name}
              noMail={!fresh.account.email}
              onDone={() => {
                app.setAccount(fresh.account);
                router.replace(nextPath());
              }}
            />
          </section>
        ) : mode === "pair" ? (
          <>
            {!registered && (
              <h1 className="visually-hidden" tabIndex={-1} ref={headingRef}>
                {t("login.haveTitle")} · {t("login.registerTitle")}
              </h1>
            )}
            {/* Only the login form goes once registered: the register form must stay the same one. */}
            <div className={registered ? undefined : "auth__pair"}>
              {!registered && loginForm}
              <GetStarted
                title={t("login.registerTitle")}
                heading="h2"
                intro={t("login.intro")}
                onStarted={() => setRegistered(true)}
                onDone={(r) => {
                  app.setAccount(r.account);
                  router.replace(nextPath());
                }}
              />
            </div>
          </>
        ) : mode === "lost" ? (
          <form className="auth__card" onSubmit={onLost} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.lostTitle")}
            </h1>
            <p className="auth__intro">{t("login.lostIntro")}</p>
            {/* Before the field: the server always answers "on its way", so after sending it is too late to learn this. */}
            <Callout tone="info">{t("login.lostNoMail")}</Callout>
            <TextField
              ref={emailRef}
              label={t("login.lostEmailLabel")}
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
              onBlur={() =>
                email.trim() && !MAIL.test(email.trim()) && setEmailError(t("login.emailInvalid"))
              }
            />
            {errorBox}
            <Button type="submit" block busy={busy} busyLabel={t("login.lostSending")}>
              {t("login.lostSend")}
            </Button>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("pair")}>
                {t("login.toLogin")}
              </button>
            </p>
          </form>
        ) : (
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
              <button type="button" className="link-button" onClick={() => go("pair")}>
                {t("login.toLogin")}
              </button>
            </p>
          </section>
        )}
      </div>
    </GuestShell>
  );
}
