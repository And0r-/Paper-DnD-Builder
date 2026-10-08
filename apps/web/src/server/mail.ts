/**
 * Outgoing mail: "you are in a campaign now". Passwords are never mailed;
 * they are shown once on the screen (see auth/accounts.ts).
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
    // Without implicit TLS, insist on STARTTLS: mails name people and campaigns.
    requireTLS: !smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
  });
  return {
    async send(mail) {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

/** Who added a person to which campaign; named in the mail, so nobody is added unseen. */
export interface Invitation {
  /** The game master's name. */
  by: string;
  campaign: string;
}

/** To an existing account that a game master added to a campaign. No password: theirs stays. */
export function addedToCampaignMail(
  language: string,
  to: string,
  baseUrl: URL | undefined,
  invitation: Invitation,
): Mail {
  const link = baseUrl ? baseUrl.origin : undefined;
  if (language === "de") {
    return {
      to,
      subject: "Du bist jetzt in einer Kampagne",
      text: [
        `${invitation.by} hat dich zur Kampagne „${invitation.campaign}“ hinzugefügt.`,
        `${invitation.by} leitet die Kampagne und kann deine Charaktere sehen, ändern und drucken.`,
        "",
        ...(link ? [`Du findest die Kampagne nach dem Anmelden: ${link}`, ""] : []),
        "Willst du das nicht? Dann kannst du die Kampagne nach dem Anmelden verlassen.",
      ].join("\n"),
    };
  }
  return {
    to,
    subject: "You are in a campaign now",
    text: [
      `${invitation.by} added you to the campaign "${invitation.campaign}".`,
      `${invitation.by} leads the campaign and can see, change and print your characters.`,
      "",
      ...(link ? [`You find the campaign after logging in: ${link}`, ""] : []),
      "Do not want this? Then leave the campaign after logging in.",
    ].join("\n"),
  };
}
