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
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type Account, type FreshPasswordInfo } from "../../src/ui/api.ts";
import { Button } from "../../src/ui/components/Button.tsx";
import { Callout } from "../../src/ui/components/Feedback.tsx";
import { Explained } from "../../src/ui/components/Explained.tsx";
import { TextField } from "../../src/ui/components/Fields.tsx";
import { FreshPassword } from "../../src/ui/components/FreshPassword.tsx";
import { GuestShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";

type Mode = "start" | "login" | "legacy";

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server's limit for a name (see API.md). */
const MAX_NAME = 80;

export default function LoginPage() {
  const app = useApp();
  const { t, tc, lang, account } = app;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("start");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  // A password just made: shown until the player says they have it. The
  // account is taken over only then, so nothing moves on before.
  const [fresh, setFresh] = useState<{ account: Account; secret: string }>();
  const nameRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
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
          : t("login.title"),
  ]);

  useEffect(() => {
    if (account && !fresh) router.replace("/characters");
  }, [account, fresh, router]);

  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus());

  const go = (m: Mode) => {
    setMode(m);
    setFormError(undefined);
    setPasswordError(undefined);
    setEmailError(undefined);
    setNameError(undefined);
    setPassword("");
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

  const onStart = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("login.nameMissing"));
      nameRef.current?.focus();
      return;
    }
    if (!checkEmail(false)) return;
    setFormError(undefined);
    setBusy(true);
    try {
      showFresh(
        await api<{ account: Account; password: FreshPasswordInfo }>("POST", "/api/auth/signup", {
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          language: lang,
        }),
      );
    } catch (error) {
      const err = failure(error);
      if (err.status === 429) setFormError(tc("login.tooManySignups", minutes(err)));
      else if (err.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
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
      router.replace("/characters");
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
                router.replace("/characters");
              }}
            />
          </section>
        ) : mode === "start" ? (
          <form className="auth__card" onSubmit={onStart} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.title")}
            </h1>
            <p className="auth__intro">{t("login.intro")}</p>
            <TextField
              ref={nameRef}
              label={t("login.nameLabel")}
              help={t("login.nameHelp")}
              autoComplete="nickname"
              maxLength={MAX_NAME}
              value={name}
              error={nameError}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(undefined);
              }}
            />
            <TextField
              ref={emailRef}
              label={t("login.emailLabel")}
              help={t("login.emailHelp")}
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
            <Button type="submit" block busy={busy} busyLabel={t("login.starting")}>
              {t("login.start")}
            </Button>
            <p className="auth__small">
              {t("login.privacyNote")} <Link href="/privacy">{t("login.privacyLink")}</Link>
            </p>
            <p className="auth__switch">
              <button type="button" className="link-button" onClick={() => go("login")}>
                {t("login.havePassword")}
              </button>
            </p>
          </form>
        ) : mode === "login" ? (
          <form className="auth__card" onSubmit={onLogin} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.haveTitle")}
            </h1>
            <p className="auth__intro">{t("login.haveIntro")}</p>
            {passwordField(t("login.passwordLabel"))}
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
        ) : (
          <form className="auth__card" onSubmit={onLegacy} noValidate>
            <h1 className="auth__title" tabIndex={-1} ref={headingRef}>
              {t("login.legacyTitle")}
            </h1>
            <p className="auth__intro">{t("login.legacyIntro")}</p>
            <TextField
              ref={emailRef}
              label={t("login.legacyEmailLabel")}
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
