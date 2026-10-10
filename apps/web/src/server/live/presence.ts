/**
 * How many people are using the builder now, for the admin (AND-353),
 * without keeping who or when: only in this process's memory, gone with a
 * restart, never in the database. Like the rate limits.
 *
 * Per browser session, the last request's time rounded down to 5 minutes;
 * nothing else. Entries older than 15 minutes go whenever the count is
 * asked for. One process serves the builder (see the README), so its count
 * is everyone's.
 */

/** Times are kept to this, no finer. */
export const PRESENCE_BUCKET_MS = 5 * 60_000;
/** A session counts as active with a request in this time. */
export const ACTIVE_MS = 10 * 60_000;
/** Entries older than this go. */
export const FORGET_MS = 15 * 60_000;

const bucket = (t: number) => Math.floor(t / PRESENCE_BUCKET_MS) * PRESENCE_BUCKET_MS;

export class Presence {
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** A request of this session (the session's id, a hash of its cookie) came in. */
  touch(sessionId: string): void {
    this.seen.set(sessionId, bucket(this.now()));
  }

  /**
   * Sessions with a request in the last 10 minutes. The times are rounded
   * down, so a request up to 5 minutes earlier may still count.
   */
  activeNow(): number {
    const now = this.now();
    let active = 0;
    for (const [id, at] of this.seen) {
      if (at < now - FORGET_MS) this.seen.delete(id);
      else if (at >= bucket(now - ACTIVE_MS)) active++;
    }
    return active;
  }

  /** How many sessions are kept; for tests. */
  get size(): number {
    return this.seen.size;
  }
}
