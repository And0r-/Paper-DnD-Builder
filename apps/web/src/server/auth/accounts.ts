/**
 * Accounts: mail addresses, issuing passwords, logging in.
 *
 * Flow (plan 5.3): a player enters a mail address; the server makes a
 * password and mails it. The same request on an existing account makes a
 * new password and the old one stops working ("reset"). Nobody ever sets
 * a password themselves.
 */
import { randomUUID } from "node:crypto";
import { printChoiceOf } from "@builder/sheet/printouts";
import { z } from "zod";
import type { App } from "../app.ts";
import { HttpError } from "../api/http.ts";
import {
  addedToCampaignMail,
  MailNotConfiguredError,
  passwordMail,
  type Invitation,
  type Mail,
} from "../mail.ts";
import type { AccountRow } from "../store.ts";
import {
  dummyPasswordHash,
  generatePassword,
  hashPassword,
  MAX_PASSWORD_INPUT,
  verifyPassword,
} from "./password.ts";
import { LIMITS, type Limit } from "./rate-limit.ts";
import { newSessionToken, SESSION_MS, sessionId } from "./session.ts";

/** Languages the builder's own screens and mails exist in. */
export const UI_LANGUAGES = ["de", "en"] as const;
export const DEFAULT_LANGUAGE = "de";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "not a mail address");

export const passwordInputSchema = z.string().min(1).max(MAX_PASSWORD_INPUT);

export function limited(app: App, key: string, limit: Limit, take: boolean): void {
  const r = take ? app.limiter.take(key, limit) : app.limiter.check(key, limit);
  if (!r.ok) {
    throw new HttpError(
      429,
      "tooManyAttempts",
      { retryAfter: r.retryAfter },
      { "Retry-After": String(r.retryAfter) },
    );
  }
}

// Requests for the same address run one after another, so two quick
// requests cannot leave a password in the mail that is not the stored one.
const queues = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(fn);
  queues.set(key, run);
  try {
    return await run;
  } finally {
    if (queues.get(key) === run) queues.delete(key);
  }
}

async function deliver(app: App, mail: Mail) {
  try {
    await app.mailer.send(mail);
  } catch (error) {
    if (error instanceof MailNotConfiguredError) throw new HttpError(503, "mailNotConfigured");
    // The error text of the mail library never contains the mail body.
    console.error("Mail: sending failed:", (error as Error).message);
    throw new HttpError(502, "mailFailed");
  }
}

async function sendPassword(
  app: App,
  account: { email: string; language: string },
  password: string,
  isNew: boolean,
) {
  await deliver(app, passwordMail(account.language, account.email, password, app.config.baseUrl, isNew));
}

/**
 * Makes a password for an address and mails it: a new account if there is
 * none, else a new password for the existing one. The answer is the same
 * either way, so it does not reveal who has an account. The mail goes out
 * before anything is stored: if it fails, the old password still works.
 */
export async function requestPassword(app: App, email: string, language: string | undefined, ip: string) {
  limited(app, `password:ip:${ip}`, LIMITS.passwordMailsPerIp, true);
  limited(app, `password:account:${email}`, LIMITS.passwordMailsPerAccount, true);
  await serialized(email, async () => {
    const existing = await app.store.findAccountByEmail(email);
    const lang =
      existing?.language ?? (UI_LANGUAGES.includes(language as never) ? language! : DEFAULT_LANGUAGE);
    const password = generatePassword(lang);
    const hash = await hashPassword(password);
    await sendPassword(app, { email, language: lang }, password, !existing);
    if (existing) {
      await app.store.setPasswordHash(existing.id, hash);
      return;
    }
    const created = await app.store.createAccount({
      id: randomUUID(),
      email,
      password_hash: hash,
      language: lang,
      created_at: app.now(),
    });
    // Another server process created it in the meantime: the mailed password wins.
    if (!created) {
      const other = await app.store.findAccountByEmail(email);
      if (other) await app.store.setPasswordHash(other.id, hash);
    }
  });
}

/**
 * The account a game master adds to a campaign, by mail address. An
 * address without an account gets one, and the password mail names who
 * invited it; an existing account keeps its password and gets a short
 * mail. Either way the person learns who can now see their characters.
 * As with `requestPassword`, the mail goes out before anything is stored.
 *
 * `add` puts the account into the campaign; it runs inside the same
 * per-address queue, so the account cannot be made twice meanwhile.
 */
export async function inviteAccount(
  app: App,
  email: string,
  language: string | undefined,
  invitation: Invitation,
  add: (account: AccountRow) => Promise<void>,
): Promise<AccountRow> {
  limited(app, `invite:address:${email}`, LIMITS.invitationMailsPerAddress, false);
  return serialized(email, async () => {
    const existing = await app.store.findAccountByEmail(email);
    if (existing) {
      app.limiter.record(`invite:address:${email}`, LIMITS.invitationMailsPerAddress);
      await deliver(app, addedToCampaignMail(existing.language, email, app.config.baseUrl, invitation));
      await add(existing);
      return existing;
    }
    limited(app, `password:account:${email}`, LIMITS.passwordMailsPerAccount, true);
    app.limiter.record(`invite:address:${email}`, LIMITS.invitationMailsPerAddress);
    const lang = UI_LANGUAGES.includes(language as never) ? language! : DEFAULT_LANGUAGE;
    const password = generatePassword(lang);
    const hash = await hashPassword(password);
    await deliver(app, passwordMail(lang, email, password, app.config.baseUrl, true, invitation));
    let account = await app.store.createAccount({
      id: randomUUID(),
      email,
      password_hash: hash,
      language: lang,
      created_at: app.now(),
    });
    // Another server process created it in the meantime: the mailed password wins.
    if (!account) {
      account = await app.store.findAccountByEmail(email);
      if (!account) throw new Error("account vanished while being made");
      await app.store.setPasswordHash(account.id, hash);
    }
    await add(account);
    return account;
  });
}

/** A new password for a logged-in account; every other session of it ends. */
export async function renewPassword(app: App, account: AccountRow, keepSession: string): Promise<void> {
  limited(app, `password:account:${account.email}`, LIMITS.passwordMailsPerAccount, true);
  await serialized(account.email, async () => {
    const password = generatePassword(account.language);
    const hash = await hashPassword(password);
    await sendPassword(app, account, password, false);
    await app.store.setPasswordHash(account.id, hash);
    await app.store.deleteOtherSessions(account.id, keepSession);
  });
}

/**
 * Checks a password and opens a session. Failed attempts are limited per
 * address and per IP. Unknown addresses take as long as known ones and get
 * the same answer.
 */
export async function login(app: App, email: string, password: string, ip: string) {
  const accountKey = `login:account:${email}`;
  const ipKey = `login:ip:${ip}`;
  limited(app, ipKey, LIMITS.loginFailuresPerIp, false);
  limited(app, accountKey, LIMITS.loginFailuresPerAccount, false);

  const account = await app.store.findAccountByEmail(email);
  const ok = await verifyPassword(account?.password_hash ?? (await dummyPasswordHash()), password);
  if (!account || !ok) {
    app.limiter.record(ipKey, LIMITS.loginFailuresPerIp);
    app.limiter.record(accountKey, LIMITS.loginFailuresPerAccount);
    throw new HttpError(401, "wrongMailOrPassword");
  }
  app.limiter.reset(accountKey);

  const token = newSessionToken();
  const now = app.now();
  // Housekeeping on a rare, cheap occasion: expired sessions are just dead rows.
  await app.store.deleteExpiredSessions(now);
  await app.store.createSession(sessionId(token), account.id, new Date(now.getTime() + SESSION_MS), now);
  return { account, token };
}

export function publicAccount(a: AccountRow) {
  return {
    email: a.email,
    language: a.language,
    units: a.units,
    print: printChoiceOf(a.print_choice),
    createdAt: a.created_at.toISOString(),
  };
}
