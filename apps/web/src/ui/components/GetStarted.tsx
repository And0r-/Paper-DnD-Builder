"use client";
/**
 * "Get started" (AND-235): a name and, if wanted, a mail address (only a
 * way back in). The server makes the account and its password; the caller
 * shows the password once (FreshPassword). Used on the login screen and on
 * an invitation (AND-237), so a newcomer joins without a detour.
 */
import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError, type Account, type FreshPasswordInfo } from "../api.ts";
import { Button } from "./Button.tsx";
import { Callout } from "./Feedback.tsx";
import { TextField } from "./Fields.tsx";

export const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server's limit for a name (see API.md). */
const MAX_NAME = 80;

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
}: {
  title: string;
  /** "h2" under a page heading of its own (the invitation). */
  heading?: "h1" | "h2";
  intro: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Below the form: the switch to "I already have a password". */
  footer?: ReactNode;
  onStarted: (r: Started) => void;
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("login.nameMissing"));
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
      onStarted(
        await api<Started>("POST", "/api/auth/signup", {
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          language: lang,
        }),
      );
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError(0, "network");
      if (err.status === 429)
        setFormError(tc("login.tooManySignups", Math.max(1, Math.ceil((err.retryAfter ?? 300) / 60))));
      else if (err.isNetwork) setFormError(t("common.offline"));
      else setFormError(t("common.loadError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth__card" onSubmit={onSubmit} noValidate>
      <Heading className="auth__title" tabIndex={-1} ref={headingRef}>
        {title}
      </Heading>
      <p className="auth__intro">{intro}</p>
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
    </form>
  );
}
