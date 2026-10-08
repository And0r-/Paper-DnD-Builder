/**
 * Sliding-window rate limits, kept in memory only.
 *
 * Deliberately not in the database: the keys contain mail and IP addresses,
 * and we store nothing about people beyond what the plan allows. The cost
 * is that a restart forgets the counters, which is acceptable for a single
 * server. Running several web containers would need a shared store.
 */

export interface Limit {
  /** Events allowed per window. */
  max: number;
  windowMs: number;
}

export interface LimitCheck {
  ok: boolean;
  /** Seconds until the next event is allowed (when not ok). */
  retryAfter: number;
}

export class RateLimiter {
  private readonly events = new Map<string, number[]>();
  private readonly now: () => number;
  private checks = 0;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Would one more event under `key` stay within the limit? Does not record anything. */
  check(key: string, limit: Limit): LimitCheck {
    const recent = this.recent(key, limit.windowMs);
    if (recent.length < limit.max) return { ok: true, retryAfter: 0 };
    const oldest = recent[recent.length - limit.max]!;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + limit.windowMs - this.now()) / 1000)) };
  }

  record(key: string, limit: Limit): void {
    const recent = this.recent(key, limit.windowMs);
    recent.push(this.now());
    // Keep only what the limit can ever look at.
    this.events.set(key, recent.slice(-limit.max));
    if (++this.checks % 1000 === 0) this.prune(limit.windowMs);
  }

  /** Checks and records in one go: for limits on attempts rather than failures. */
  take(key: string, limit: Limit): LimitCheck {
    const r = this.check(key, limit);
    if (r.ok) this.record(key, limit);
    return r;
  }

  reset(key: string): void {
    this.events.delete(key);
  }

  private recent(key: string, windowMs: number): number[] {
    const since = this.now() - windowMs;
    return (this.events.get(key) ?? []).filter((t) => t > since);
  }

  /** Drops keys with nothing recent, so memory does not grow with every address ever seen. */
  private prune(windowMs: number): void {
    const since = this.now() - windowMs * 24;
    for (const [key, times] of this.events) if ((times.at(-1) ?? 0) <= since) this.events.delete(key);
  }
}

const MINUTE = 60_000;

/**
 * Limits used by the login. Failed logins are counted per IP; failed logins
 * with an old password (address and password) per address too. New
 * accounts are counted per IP. Mails with a way back in are counted per
 * address and per IP, whether the address has an account or not.
 */
export const LIMITS = {
  loginFailuresPerAccount: { max: 10, windowMs: 15 * MINUTE },
  loginFailuresPerIp: { max: 30, windowMs: 15 * MINUTE },
  // A family or a club behind one address signs up together; a script does not get far.
  signupsPerIp: { max: 10, windowMs: 60 * MINUTE },
  // Enough to ask again when a mail is slow; not enough to flood a mailbox.
  resetMailsPerAddress: { max: 3, windowMs: 60 * MINUTE },
  resetMailsPerIp: { max: 10, windowMs: 60 * MINUTE },
  // A token has 256 bits; this only keeps a guessing loop from costing the server anything.
  resetUsesPerIp: { max: 20, windowMs: 15 * MINUTE },
  // New invitation links for a game master's campaigns; plenty for anyone who does it by hand.
  invitationsPerAccount: { max: 30, windowMs: 60 * MINUTE },
  // New help links for one's own characters; plenty for anyone who does it by hand.
  helpLinksPerAccount: { max: 30, windowMs: 60 * MINUTE },
  // Opening or using an invitation link: a whole table on one Wi-Fi, several times over.
  // A token has 128 bits; this only keeps a guessing loop from costing the server anything.
  inviteOpensPerIp: { max: 60, windowMs: 15 * MINUTE },
  // Requests to the public MCP server, with or without a valid key. A language model
  // building a character makes a few calls a minute; a loop or a key guesser hits this.
  mcpRequestsPerIp: { max: 120, windowMs: MINUTE },
} as const satisfies Record<string, Limit>;
