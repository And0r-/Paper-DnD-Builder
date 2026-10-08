/**
 * Accounts: signing up, passwords, logging in.
 *
 * Flow (AND-233, replacing the password mails of plan 5.3): a player gives
 * a name and, if they want, a mail address, kept only as a way back in.
 * The server makes a password, shows it once on the screen and logs the
 * player in at once; nothing waits for a mail. Logging in later is the
 * password alone. An account may have several passwords (one per device,
 * one on paper), which its owner makes and deletes in the settings; the
 * last one cannot be deleted. Nobody ever chooses a password themselves.
 *
 * A plain password appears in exactly one answer, the one that made it. It
 * is never stored (only its hash, see password.ts) and never logged.
 *
 * Whoever loses every password and gave an address asks for a link back in
 * (`requestReset`): a mail with a one-time link per account, valid 30
 * minutes, which shows a new password on the screen (`useReset`).
 *
 * Accounts from before had one password, mailed to them, and are found by
 * their address. Their owner logs in once with address and password
 * (`legacyLogin`) and gets a password of the new kind in exchange.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { printChoiceOf } from "@builder/sheet/printouts";
import { z } from "zod";
import type { App } from "../app.ts";
import { HttpError } from "../api/http.ts";
import { MailNotConfiguredError, resetMail, type Mail } from "../mail.ts";
import type { AccountRow, PasswordOrigin } from "../store.ts";
import {
  dummyPasswordHash,
  generatePassword,
  MAX_PASSWORD_INPUT,
  passwordHash,
  verifyPassword,
} from "./password.ts";
import { LIMITS, type Limit } from "./rate-limit.ts";
import { newSessionToken, SESSION_MS, sessionId } from "./session.ts";

/** Languages the builder's own screens and mails exist in. */
export const UI_LANGUAGES = ["de", "en"] as const;
export const DEFAULT_LANGUAGE = "de";

/** Enough for every device and a copy on paper; stops a loop from filling the table. */
export const MAX_PASSWORDS_PER_ACCOUNT = 10;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "not a mail address");

/**
 * One line of plain text, 1 to 80 characters: a person's name, a campaign's,
 * a password's. A name is shown to others (a campaign's on its invitation
 * page, a game master's there too), never as markup.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, "no control characters");

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

function uiLanguage(language: string | undefined): string {
  return UI_LANGUAGES.includes(language as never) ? language! : DEFAULT_LANGUAGE;
}

/**
 * Makes a password for the account and stores its hash. Returns the plain
 * password for the one answer that shows it, or undefined if the account
 * already has the most it may.
 */
export async function makePassword(
  app: App,
  account: { id: string; language: string },
  name: string | null,
  origin: PasswordOrigin | null = null,
) {
  const secret = generatePassword(account.language);
  const row = await app.store.createPassword(
    {
      id: randomUUID(),
      account_id: account.id,
      hash: passwordHash(secret),
      name,
      origin,
      created_at: app.now(),
    },
    MAX_PASSWORDS_PER_ACCOUNT,
  );
  return row && { row, secret };
}

async function openSession(app: App, accountId: string): Promise<string> {
  const token = newSessionToken();
  const now = app.now();
  // Housekeeping on a rare, cheap occasion: expired sessions are just dead rows.
  await app.store.deleteExpiredSessions(now);
  await app.store.createSession(sessionId(token), accountId, new Date(now.getTime() + SESSION_MS), now);
  return token;
}

/**
 * A new account with its first password, logged in at once. Limited per
 * IP, so a script cannot fill the database with accounts.
 */
export async function signup(
  app: App,
  body: { name: string; email?: string | null | undefined; language?: string | undefined },
  ip: string,
) {
  limited(app, `signup:ip:${ip}`, LIMITS.signupsPerIp, true);
  const account = await app.store.createAccount({
    id: randomUUID(),
    name: body.name,
    email: body.email ?? null,
    language: uiLanguage(body.language),
    created_at: app.now(),
  });
  const made = (await makePassword(app, account, null, "first"))!;
  const token = await openSession(app, account.id);
  return { account, password: made, token };
}

/**
 * Logs in with a password alone: it is found by its hash. Failures are
 * limited per IP; there is no account to count them against, and a guess
 * is a guess at every account at once, which 60 bits make hopeless.
 */
export async function login(app: App, password: string, ip: string) {
  const ipKey = `login:ip:${ip}`;
  limited(app, ipKey, LIMITS.loginFailuresPerIp, false);
  const account = await app.store.findAccountByPasswordHash(passwordHash(password));
  if (!account) {
    app.limiter.record(ipKey, LIMITS.loginFailuresPerIp);
    throw new HttpError(401, "wrongPassword");
  }
  return { account, token: await openSession(app, account.id) };
}

/**
 * Logs in an account from before with its address and its old password,
 * once: the old password is swapped for one of the new kind, shown in the
 * answer. Failed attempts are limited per address and per IP. Unknown
 * addresses take as long as known ones and get the same answer.
 */
export async function legacyLogin(app: App, email: string, password: string, ip: string) {
  const accountKey = `login:account:${email}`;
  const ipKey = `login:ip:${ip}`;
  limited(app, ipKey, LIMITS.loginFailuresPerIp, false);
  limited(app, accountKey, LIMITS.loginFailuresPerAccount, false);

  const account = await app.store.findLegacyAccount(email);
  const oldHash = account?.password_hash ?? (await dummyPasswordHash());
  const ok = await verifyPassword(oldHash, password);
  const secret = account && ok ? generatePassword(account.language) : undefined;
  // Swapped in one statement, and only while the old password is still the one
  // checked: two logins at once cannot both get through.
  const row =
    account && secret
      ? await app.store.replaceLegacyPassword(account.id, oldHash, {
          id: randomUUID(),
          account_id: account.id,
          hash: passwordHash(secret),
          name: null,
          origin: "first",
          created_at: app.now(),
        })
      : undefined;
  if (!account || !secret || !row) {
    app.limiter.record(ipKey, LIMITS.loginFailuresPerIp);
    app.limiter.record(accountKey, LIMITS.loginFailuresPerAccount);
    throw new HttpError(401, "wrongMailOrPassword");
  }
  app.limiter.reset(accountKey);
  const token = await openSession(app, account.id);
  return { account: { ...account, password_hash: null }, password: { row, secret }, token };
}

/** How long a link back in works. */
export const RESET_LINK_MINUTES = 30;

/** The stored form of a reset token, like a session's: its SHA-256. */
const resetLinkId = sessionId;

/**
 * Mails a link back in to every account with this address, in one mail,
 * each with the account's name. Answers the same whether the address has
 * an account or not, so nobody learns who has one; limited per address and
 * per IP either way. The mail goes out before the links are stored: if
 * sending fails, no link exists that nobody got.
 *
 * Needs BASE_URL for the links: taken from the request instead, a forged
 * Host header could send a working link to someone else's server.
 */
export async function requestReset(
  app: App,
  email: string,
  language: string | undefined,
  ip: string,
): Promise<void> {
  limited(app, `reset:ip:${ip}`, LIMITS.resetMailsPerIp, true);
  limited(app, `reset:address:${email}`, LIMITS.resetMailsPerAddress, true);
  const accounts = await app.store.findAccountsByEmail(email);
  if (accounts.length === 0) return;
  const base = app.config.baseUrl;
  if (!base) throw new HttpError(503, "mailNotConfigured");

  const links = accounts.map((account) => ({ account, token: randomBytes(32).toString("base64url") }));
  await deliver(
    app,
    resetMail(
      accounts[0]!.language || uiLanguage(language),
      email,
      links.map((l) => ({ name: l.account.name, url: new URL(`/login/reset/${l.token}`, base).href })),
      RESET_LINK_MINUTES,
    ),
  );
  const now = app.now();
  await app.store.deleteExpiredResetLinks(now);
  await app.store.createResetLinks(
    links.map((l) => ({ id: resetLinkId(l.token), account_id: l.account.id })),
    new Date(now.getTime() + RESET_LINK_MINUTES * 60_000),
    now,
  );
}

/**
 * Uses a link back in, once: logs its account in and makes a new password
 * without a name (the screen calls it "New from email link"). The
 * account's other passwords stay; its owner deletes them in the settings
 * if one is lost. If the account already has
 * the most passwords it may, the oldest goes, so this never fails.
 */
export async function useReset(app: App, token: string, ip: string) {
  limited(app, `reset-use:ip:${ip}`, LIMITS.resetUsesPerIp, true);
  const account = await app.store.takeResetLink(resetLinkId(token), app.now());
  if (!account) throw new HttpError(404, "resetLinkInvalid");
  const secret = generatePassword(account.language);
  const row = await app.store.createPasswordReplacingOldest(
    {
      id: randomUUID(),
      account_id: account.id,
      hash: passwordHash(secret),
      name: null,
      origin: "reset",
      created_at: app.now(),
    },
    MAX_PASSWORDS_PER_ACCOUNT,
  );
  return { account, password: { row, secret }, session: await openSession(app, account.id) };
}

export function publicAccount(a: AccountRow) {
  return {
    name: a.name,
    email: a.email,
    language: a.language,
    units: a.units,
    print: printChoiceOf(a.print_choice),
    createdAt: a.created_at.toISOString(),
  };
}
