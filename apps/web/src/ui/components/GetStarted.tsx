"use client";
/**
 * "Get started" (AND-235): a name and, if wanted, a mail address (only a
 * way back in). The server makes the account and its password, shown once
 * in this same form (AND-241): Firefox offers to save a password only from
 * a form the player typed into, so the name field is the user name and the
 * hidden new-password field is there from the start. Used on the login
 * screen and on an invitation (AND-237), so a newcomer joins without a
 * detour. The caller keeps this component in its place while the password
 * shows, or the form would be a new one.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { isAccountName, MAX_ACCOUNT_NAME } from "../../shared/account-name.ts";
import { useApp } from "../app-state.tsx";
import { api, ApiError, type Account, type FreshPasswordInfo } from "../api.ts";
import { Button } from "./Button.tsx";
import { Callout } from "./Feedback.tsx";
import { TextField } from "./Fields.tsx";
import { afterSending, FreshPasswordContent, PasswordToSave, SAVE_FORM } from "./FreshPassword.tsx";

export const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Started {
  account: Account;
  password: FreshPasswordInfo;
}

export function GetStarted({
  title,
  intro,
  headingRef,
  heading: Heading = "h1",
  footer,
  onStarted,
  onDone,
}: {
  title: string;
  /** "h2" under a page heading of its own (the invitation). */
  heading?: "h1" | "h2";
  intro: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Below the form: the switch to "I already have a password". */
  footer?: ReactNode;
  /** The account is made and its password shows. */
  onStarted?: (r: Started) => void;
  /** "I have it": the player is in. */
  onDone: (r: Started) => void;
}) {
  const { t, tc, lang } = useApp();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const nameRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [started, setStarted] = useState<Started>();
  const welcomeRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started) welcomeRef.current?.focus();
  }, [started]);

  const onSubmit = async (e: FormEvent) => {
    if (started) {
      // Sent for real, so the browser offers to save the password.
      afterSending(() => onDone(started));
      return;
    }
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("login.nameMissing"));
      nameRef.current?.focus();
      return;
    }
    if (!isAccountName(name)) {
      setNameError(t("login.nameInvalid", { max: MAX_ACCOUNT_NAME }));
      nameRef.current?.focus();
      return;
    }
    if (email.trim() && !MAIL.test(email.trim())) {
      setEmailError(t("login.emailInvalid"));
      emailRef.current?.focus();
      return;
    }
    setFormError(undefined);
    setBusy(true);
    try {
      const r = await api<Started>("POST", "/api/auth/signup", {
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        language: lang,
      });
      setStarted(r);
      onStarted?.(r);
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError(0, "network");
      if (err.status === 429)
        setFormError(tc("login.tooManySignups", Math.max(1, Math.ceil((err.retryAfter ?? 300) / 60))));
      else if (err.status === 400) setNameError(t("login.nameInvalid", { max: MAX_ACCOUNT_NAME }));
      else if (err.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth__card" {...SAVE_FORM} onSubmit={onSubmit} noValidate>
      {started ? (
        <section className="fresh-password" aria-labelledby="welcome-title">
          <h1 className="auth__title" id="welcome-title" tabIndex={-1} ref={welcomeRef}>
            {t("password.welcome", { name: started.account.name })}
          </h1>
          <FreshPasswordContent secret={started.password.secret} noMail={!started.account.email} />
        </section>
      ) : (
        <>
          <Heading className="auth__title" tabIndex={-1} ref={headingRef}>
            {title}
          </Heading>
          <p className="auth__intro">{intro}</p>
          <TextField
            ref={nameRef}
            label={t("login.nameLabel")}
            autoComplete="username"
            maxLength={MAX_ACCOUNT_NAME}
            value={name}
            error={nameError}
            onChange={(e) => {
              // The server's rule, said while typing: the name goes into the mail with the link back in.
              const n = e.target.value;
              setName(n);
              setNameError(
                !n.trim() || isAccountName(n) ? undefined : t("login.nameInvalid", { max: MAX_ACCOUNT_NAME }),
              );
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
            onBlur={() => email.trim() && !MAIL.test(email.trim()) && setEmailError(t("login.emailInvalid"))}
          />
          {formError && (
            <Callout tone="danger" role="alert">
              {formError}
            </Callout>
          )}
          <Button type="submit" block busy={busy} busyLabel={t("login.starting")}>
            {t("login.start")}
          </Button>
          <p className="auth__small">
            {t("login.privacyNote")} <Link href="/privacy">{t("login.privacyLink")}</Link>
          </p>
          {footer}
        </>
      )}
      <PasswordToSave
        username={started ? started.account.name : undefined}
        secret={started ? started.password.secret : ""}
      />
    </form>
  );
}
