/**
 * Outgoing mail: "here is your password", and "you are in a campaign now".
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

/** Who added a person to which campaign; named in the mail, so nobody is added unseen. */
export interface Invitation {
  /** The game master's mail address. */
  by: string;
  campaign: string;
}

/**
 * The password mail in the account's language. Wording is a first draft
 * and belongs to the UI texts; keep it plain and short. With `invitation`,
 * the account was made by a game master and the mail says who that was.
 */
export function passwordMail(
  language: string,
  to: string,
  password: string,
  baseUrl: URL | undefined,
  isNew: boolean,
  invitation?: Invitation,
): Mail {
  const link = baseUrl ? baseUrl.origin : undefined;
  if (language === "de") {
    return {
      to,
      subject: "Dein Passwort für den Charakterbuilder",
      text: [
        ...(invitation
          ? [
              `${invitation.by} hat dich zur Kampagne „${invitation.campaign}“ eingeladen und dir dafür ein Konto beim Charakterbuilder angelegt.`,
              `${invitation.by} leitet die Kampagne und kann deine Charaktere sehen, ändern und drucken.`,
            ]
          : [isNew ? "Willkommen beim Charakterbuilder!" : "Du hast ein neues Passwort bekommen."]),
        "",
        `Dein Passwort: ${password}`,
        "",
        ...(link ? [`Melde dich hier an: ${link}`, ""] : []),
        isNew
          ? "Du musst dir das Passwort nicht merken. Du bleibst lange angemeldet."
          : "Ab jetzt gilt nur noch dieses Passwort. Das alte funktioniert nicht mehr.",
        invitation
          ? "Willst du kein Konto? Dann melde dich an und lösche es unter Einstellungen. Dann ist alles weg."
          : "Hast du das nicht angefordert? Dann kannst du diese Mail einfach löschen.",
      ].join("\n"),
    };
  }
  return {
    to,
    subject: "Your password for the character builder",
    text: [
      ...(invitation
        ? [
            `${invitation.by} invited you to the campaign "${invitation.campaign}" and made you an account at the character builder for it.`,
            `${invitation.by} leads the campaign and can see, change and print your characters.`,
          ]
        : [isNew ? "Welcome to the character builder!" : "You have a new password."]),
      "",
      `Your password: ${password}`,
      "",
      ...(link ? [`Log in here: ${link}`, ""] : []),
      isNew
        ? "You do not need to remember it. You stay logged in for a long time."
        : "From now on only this password works. The old one no longer does.",
      invitation
        ? "Do not want an account? Then log in and delete it in the settings. Then everything is gone."
        : "Did not ask for this? Then just delete this mail.",
    ].join("\n"),
  };
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
