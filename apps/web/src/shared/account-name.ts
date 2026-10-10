/**
 * The rule for an account's name, shared by the server (which decides) and
 * the screens (which say so while typing). Stricter than other names
 * (campaigns, passwords, keys): the account's name is written into the mail
 * with a link back in, and the address is not confirmed, so anyone can make
 * an account with a stranger's address. A name that cannot hold a link or
 * look like an address cannot turn that mail into a scam (audit AND-348,
 * finding 2).
 *
 * The rule holds from sign-up on and whenever a name changes; a name saved
 * before it stays valid.
 */

/** At most this many characters, after trimming. */
export const MAX_ACCOUNT_NAME = 50;

/** One line: no control or format characters (this includes direction overrides). */
export const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/**
 * What a link or an address looks like: a scheme, `www.`, an `@`, or a
 * letter or digit, a dot and two letters with no space between
 * (`example.com`, `bit.ly/x`, `web3.io`). Initials and abbreviations keep
 * their space ("J.R.R. Tolkien", "Dr. Müller").
 */
const LINK_OR_ADDRESS = /:\/\/|www\.|@|[\p{L}\p{N}]\.\p{L}{2,}/iu;

/**
 * Whether the name holds something like a link or an address. Compared in
 * NFKC, so look-alike characters (a full-width dot or `＠`) count as the
 * plain ones.
 */
export function looksLikeLink(name: string): boolean {
  return LINK_OR_ADDRESS.test(name.normalize("NFKC"));
}

/** Whether a name, trimmed, may be an account's. */
export function isAccountName(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= MAX_ACCOUNT_NAME && !CONTROL_CHARACTERS.test(n) && !looksLikeLink(n);
}
