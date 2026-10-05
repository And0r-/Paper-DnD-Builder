"use client";
/**
 * Login (flow spec 4.1): mail address → password from the mail → in.
 * There is no "sign up": a new address gets an account, a known one a new
 * password. For the player both are the same path.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type Account } from "../../src/ui/api.ts";
import { Button } from "../../src/ui/components/Button.tsx";
import { Callout } from "../../src/ui/components/Feedback.tsx";
import { Explained } from "../../src/ui/components/Explained.tsx";
import { TextField } from "../../src/ui/components/Fields.tsx";
import { LanguageSelect } from "../../src/ui/components/LanguageSelect.tsx";
import { GuestShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";

type Mode = "email" | "check" | "have";

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_S = 60;

export default function LoginPage() {
  const app = useApp();
  const { t, tc, lang, account } = app;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [sentAt, setSentAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const emailRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const passwordRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  usePageTitle([
    mode === "check" ? t("login.checkTitle") : mode === "have" ? t("login.haveTitle") : t("login.title"),
  ]);

  useEffect(() => {
    if (account) router.replace("/characters");
  }, [account, router]);

  useEffect(() => {
    if (mode !== "check") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  const go = (m: Mode) => {
    setMode(m);
    setFormError(undefined);
    setPasswordError(undefined);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const minutes = (e: ApiError) => Math.max(1, Math.ceil((e.retryAfter ?? 300) / 60));

  const checkEmail = (): boolean => {
    const ok = MAIL.test(email.trim());
    setEmailError(ok ? undefined : t("login.emailInvalid"));
    if (!ok) emailRef.current?.focus();
    return ok;
  };

  const requestPassword = async (): Promise<boolean> => {
    setFormError(undefined);
    setBusy(true);
    try {
      await api("POST", "/api/auth/password", { email: email.trim(), language: lang });
      setSentAt(Date.now());
      setNow(Date.now());
      return true;
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError(0, "network");
      if (e.status === 400) {
        setEmailError(t("login.emailInvalid"));
        emailRef.current?.focus();
      } else if (e.status === 429) setFormError(tc("login.tooManyMails", minutes(e)));
      else if (e.code === "mailNotConfigured") setFormError(t("login.mailNotConfigured"));
      else if (e.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("login.mailFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!checkEmail()) return;
    if (await requestPassword()) {
      setPassword("");
      go("check");
    }
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "have" && !checkEmail()) return;
    if (!password.trim()) {
      setPasswordError(t("login.passwordMissing"));
      passwordRef.current?.focus();
      return;
    }
    setFormError(undefined);
    setPasswordError(undefined);
    setBusy(true);
    try {
      const r = await api<{ account: Account }>("POST", "/api/auth/login", {
        email: email.trim(),
        password: password.trim(),
      });
      app.setAccount(r.account);
      router.replace("/characters");
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError(0, "network");
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

  const wait = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));

  const passwordField = (
    <TextField
      ref={passwordRef}
      label={t("login.passwordLabel")}
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

  return (
    <GuestShell corner={<LanguageSelect compact />}>
      <div className="auth">
        {/* The name explains itself where it is seen first, as in the top bar after login (AND-90). */}
        <p className="auth__brand">
          <Explained hint={t("app.about")}>
            <span>{t("app.name")}</span>
          </Explained>
        </p>
        {mode === "email" && (
          <form className="auth__card" onSubmit={onSend} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.title")}
            </h1>
            <p className="auth__intro">{t("login.intro")}</p>
            <TextField
              ref={emailRef}
              label={t("login.emailLabel")}
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
            {formError && (
              <Callout tone="danger" role="alert">
                {formError}
              </Callout>
            )}
            <Button type="submit" block busy={busy} busyLabel={t("login.sending")} icon="mail">
              {t("login.send")}
            </Button>
            <p className="auth__small">
              {t("login.privacyNote")} <Link href="/privacy">{t("login.privacyLink")}</Link>
            </p>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("have")}>
                {t("login.havePassword")}
              </button>
            </p>
          </form>
        )}

        {mode === "check" && (
          <form className="auth__card" onSubmit={onLogin} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.checkTitle")}
            </h1>
            <p className="auth__intro">
              {t("login.checkIntro", { email: "\u0000" })
                .split("\u0000")
                .flatMap((part, i) => (i === 0 ? [part] : [<strong key={i}>{email.trim()}</strong>, part]))}
            </p>
            {passwordField}
            {formError && (
              <Callout tone="danger" role="alert">
                {formError}
              </Callout>
            )}
            <Button type="submit" block busy={busy} busyLabel={t("login.submitting")}>
              {t("login.submit")}
            </Button>
            <details className="auth__help">
              <summary>{t("login.noMail")}</summary>
              <p>{t("login.noMailHelp")}</p>
              <div className="auth__help-actions">
                <Button
                  variant="secondary"
                  aria-disabled={wait > 0 || undefined}
                  onClick={async () => {
                    if (wait > 0) return;
                    setResent(false);
                    if (await requestPassword()) setResent(true);
                  }}
                >
                  {wait > 0 ? t("login.resendIn", { seconds: wait }) : t("login.resend")}
                </Button>
                <button type="button" className="link-button" onClick={() => go("email")}>
                  {t("login.otherEmail")}
                </button>
              </div>
              <p aria-live="polite" className="auth__resent">
                {resent ? t("login.resent") : ""}
              </p>
            </details>
          </form>
        )}

        {mode === "have" && (
          <form className="auth__card" onSubmit={onLogin} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.haveTitle")}
            </h1>
            <p className="auth__intro">{t("login.haveIntro")}</p>
            <TextField
              ref={emailRef}
              label={t("login.emailLabel")}
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
            />
            {passwordField}
            {formError && (
              <Callout tone="danger" role="alert">
                {formError}
              </Callout>
            )}
            <Button type="submit" block busy={busy} busyLabel={t("login.submitting")}>
              {t("login.submit")}
            </Button>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("email")}>
                {t("login.needPassword")}
              </button>
            </p>
          </form>
        )}
      </div>
    </GuestShell>
  );
}
