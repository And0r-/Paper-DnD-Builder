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
 * Accounts from before had one password, mailed to them, and are found by
 * their address. Their owner logs in once with address and password
 * (`legacyLogin`) and gets a password of the new kind in exchange.
 */
import { randomUUID } from "node:crypto";
import { printChoiceOf } from "@builder/sheet/printouts";
import { z } from "zod";
import type { App } from "../app.ts";
import { HttpError } from "../api/http.ts";
import { addedToCampaignMail, MailNotConfiguredError, type Invitation, type Mail } from "../mail.ts";
import type { AccountRow } from "../store.ts";
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

/** One line of plain text, 1 to 80 characters: a person's name, a campaign's, a password's. */
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

// Invitations for the same address run one after another, so two quick
// ones cannot make two accounts for it.
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

function uiLanguage(language: string | undefined): string {
  return UI_LANGUAGES.includes(language as never) ? language! : DEFAULT_LANGUAGE;
}

/** The name a password gets when its owner gives none: the day it was made (2026-10-08), in no language. */
export function defaultPasswordName(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Makes a password for the account and stores its hash. Returns the plain
 * password for the one answer that shows it, or undefined if the account
 * already has the most it may.
 */
export async function makePassword(app: App, account: { id: string; language: string }, name: string) {
  const secret = generatePassword(account.language);
  const row = await app.store.createPassword(
    {
      id: randomUUID(),
      account_id: account.id,
      hash: passwordHash(secret),
      name,
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
  const made = (await makePassword(app, account, defaultPasswordName(app.now())))!;
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
          name: defaultPasswordName(app.now()),
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

/**
 * The account a game master adds to a campaign, by mail address, until
 * invitations by link come (AND-233, part 3). An existing account gets a
 * short mail that names who added it. An address without an account gets
 * one, named after the part before the "@", with no password and no mail:
 * its owner gets in only once a way back in by mail (part 2) or the
 * invitation link (part 3) exists. Meanwhile the game master can build for it.
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
    // Two accounts may give the same address; the oldest one is added.
    const existing = (await app.store.findAccountsByEmail(email))[0];
    app.limiter.record(`invite:address:${email}`, LIMITS.invitationMailsPerAddress);
    if (existing) {
      await deliver(app, addedToCampaignMail(existing.language, email, app.config.baseUrl, invitation));
      await add(existing);
      return existing;
    }
    const account = await app.store.createAccount({
      id: randomUUID(),
      name: email.split("@")[0]!.slice(0, 80),
      email,
      language: uiLanguage(language),
      created_at: app.now(),
    });
    await add(account);
    return account;
  });
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
