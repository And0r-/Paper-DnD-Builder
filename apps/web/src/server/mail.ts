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

interface ResetWords {
  subject: string;
  one: string;
  many: string;
  rules: (minutes: number) => string;
  notYou: string;
}

const RESET_WORDS: Readonly<Record<string, ResetWords>> = {
  de: {
    subject: "Dein Link zum Anmelden",
    one: "Mit diesem Link kommst du wieder in dein Konto:",
    many: "Mit diesen Links kommst du wieder in deine Konten, je einer pro Konto:",
    rules: (m) => `Der Link gilt ${m} Minuten und geht nur einmal. Er zeigt dir ein neues Passwort.`,
    notYou: "Hast du das nicht angefordert? Dann lösche die Mail, es passiert nichts.",
  },
  en: {
    subject: "Your link to log in",
    one: "This link takes you back into your account:",
    many: "These links take you back into your accounts, one for each:",
    rules: (m) => `The link works for ${m} minutes and only once. It shows you a new password.`,
    notYou: "You did not ask for this? Then delete this email. Nothing will happen.",
  },
  fr: {
    subject: "Votre lien pour vous connecter",
    one: "Avec ce lien, vous revenez dans votre compte :",
    many: "Avec ces liens, vous revenez dans vos comptes, un lien par compte :",
    rules: (m) => `Le lien marche ${m} minutes et une seule fois. Il vous montre un nouveau mot de passe.`,
    notYou: "Vous n’avez rien demandé ? Alors effacez ce message. Il ne se passe rien.",
  },
  it: {
    subject: "Il tuo link per accedere",
    one: "Con questo link torni nel tuo account:",
    many: "Con questi link torni nei tuoi account, uno per ogni account:",
    rules: (m) => `Il link vale ${m} minuti e funziona una volta sola. Ti mostra una nuova password.`,
    notYou: "Non l'hai chiesto tu? Allora cancella questa e-mail. Non succede niente.",
  },
  es: {
    subject: "Tu enlace para entrar",
    one: "Con este enlace vuelves a entrar en tu cuenta:",
    many: "Con estos enlaces vuelves a entrar en tus cuentas, uno por cuenta:",
    rules: (m) => `El enlace vale ${m} minutos y solo funciona una vez. Te muestra una contraseña nueva.`,
    notYou: "¿No lo has pedido tú? Entonces borra este correo. No pasa nada.",
  },
};

/** The link (or links: one per account with the address) back in. No password: the link shows one. */
export function resetMail(language: string, to: string, links: ResetLink[], minutes: number): Mail {
  const w = RESET_WORDS[language] ?? RESET_WORDS["en"]!;
  return {
    to,
    subject: w.subject,
    text: [
      links.length > 1 ? w.many : w.one,
      "",
      ...links.map((l) => `${l.name}: ${l.url}`),
      "",
      w.rules(minutes),
      "",
      w.notYou,
    ].join("\n"),
  };
}
