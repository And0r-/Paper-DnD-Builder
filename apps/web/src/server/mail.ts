/**
 * Outgoing mail. Only one kind exists: "here is your password".
 *
 * Mail goes through the owner's own SMTP server; no third party sees it.
 * The password appears in the mail body and nowhere else: it is not
 * logged, not stored, not returned by the API.
 */
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("SMTP is not configured (SMTP_HOST, MAIL_FROM). See .env.example.");
    this.name = "MailNotConfiguredError";
  }
}

export function createSmtpMailer(smtp: SmtpConfig | undefined, from: string | undefined): Mailer {
  if (!smtp || !from) {
    return {
      send: () => Promise.reject(new MailNotConfiguredError()),
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // Without implicit TLS, insist on STARTTLS: the mail carries a password.
    requireTLS: !smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
  });
  return {
    async send(mail) {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

/**
 * The password mail in the account's language. Wording is a first draft
 * and belongs to the UI texts; keep it plain and short.
 */
export function passwordMail(
  language: string,
  to: string,
  password: string,
  baseUrl: URL | undefined,
  isNew: boolean,
): Mail {
  const link = baseUrl ? baseUrl.origin : undefined;
  if (language === "de") {
    return {
      to,
      subject: "Dein Passwort für den Charakterbuilder",
      text: [
        isNew ? "Willkommen beim Charakterbuilder!" : "Du hast ein neues Passwort bekommen.",
        "",
        `Dein Passwort: ${password}`,
        "",
        ...(link ? [`Melde dich hier an: ${link}`, ""] : []),
        isNew
          ? "Du musst dir das Passwort nicht merken. Du bleibst lange angemeldet."
          : "Ab jetzt gilt nur noch dieses Passwort. Das alte funktioniert nicht mehr.",
        "Hast du das nicht angefordert? Dann kannst du diese Mail einfach löschen.",
      ].join("\n"),
    };
  }
  return {
    to,
    subject: "Your password for the character builder",
    text: [
      isNew ? "Welcome to the character builder!" : "You have a new password.",
      "",
      `Your password: ${password}`,
      "",
      ...(link ? [`Log in here: ${link}`, ""] : []),
      isNew
        ? "You do not need to remember it. You stay logged in for a long time."
        : "From now on only this password works. The old one no longer does.",
      "Did not ask for this? Then just delete this mail.",
    ].join("\n"),
  };
}
