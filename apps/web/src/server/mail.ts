/**
 * Outgoing mail: only the link back in for whoever lost every password.
 * Invitations to a campaign are links the game master sends themselves.
 * Passwords are never mailed; they are shown
 * once on the screen (see auth/accounts.ts). The link back in opens the
 * account once, within 30 minutes, so it is still worth protecting on the way.
 *
 * Mail goes through the owner's own SMTP server; no third party sees it.
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
    // Without implicit TLS, insist on STARTTLS: a link back in opens an account
    // until it is used or expires.
    requireTLS: !smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
  });
  return {
    async send(mail) {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

/** One account's link back in, named so a player with several accounts knows which is which. */
export interface ResetLink {
  name: string;
  url: string;
}

/** The link (or links: one per account with the address) back in. No password: the link shows one. */
export function resetMail(language: string, to: string, links: ResetLink[], minutes: number): Mail {
  const lines = links.map((l) => `${l.name}: ${l.url}`);
  if (language === "de") {
    return {
      to,
      subject: "Dein Link zum Anmelden",
      text: [
        links.length > 1
          ? "Mit diesen Links kommst du wieder in deine Konten, je einer pro Konto:"
          : "Mit diesem Link kommst du wieder in dein Konto:",
        "",
        ...lines,
        "",
        `Der Link gilt ${minutes} Minuten und geht nur einmal. Er zeigt dir ein neues Passwort.`,
        "",
        "Hast du das nicht angefordert? Dann lösche die Mail, es passiert nichts.",
      ].join("\n"),
    };
  }
  return {
    to,
    subject: "Your link to log in",
    text: [
      links.length > 1
        ? "These links take you back into your accounts, one for each:"
        : "This link takes you back into your account:",
      "",
      ...lines,
      "",
      `The link works for ${minutes} minutes and only once. It shows you a new password.`,
      "",
      "Did not ask for this? Then delete the mail, nothing happens.",
    ].join("\n"),
  };
}
