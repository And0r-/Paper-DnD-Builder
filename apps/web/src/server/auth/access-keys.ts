/**
 * Access keys: a second way into one's own account, for tools that talk to
 * the HTTP API without a browser (`Authorization: Bearer <key>`).
 *
 * A key is 256 random bits, like a session token, so it cannot be guessed
 * and needs no slow hash or attempt limit: the database stores its SHA-256
 * only, and a leaked database holds no usable key. The key is shown once,
 * when it is made; the owner sees the first characters (`hint`) and the
 * date in the list and can withdraw a key at any time.
 */
import { createHash, randomBytes } from "node:crypto";

/** Marks the string as a key of this builder, so it is recognised in a config file or a leak scan. */
export const KEY_PREFIX = "cbk_";
const KEY_PATTERN = /^cbk_[A-Za-z0-9_-]{43}$/;
/** Characters of the key the owner sees in the list; 6 of the 43 random characters (36 of 256 bits). */
const HINT_LENGTH = KEY_PREFIX.length + 6;

/** Enough for every tool someone uses; stops a loop from filling the table. */
export const MAX_KEYS_PER_ACCOUNT = 20;

export function newAccessKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function accessKeyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function accessKeyHint(key: string): string {
  return key.slice(0, HINT_LENGTH);
}

/**
 * The key from an `Authorization` header: `undefined` if there is no header,
 * `null` if there is one that does not hold a well-formed key.
 */
export function readBearerKey(header: string | null): string | null | undefined {
  if (header === null) return undefined;
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return m && KEY_PATTERN.test(m[1]!) ? m[1]! : null;
}
