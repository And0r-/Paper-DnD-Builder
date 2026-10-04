/**
 * Generated passwords and their hashes.
 *
 * Nobody chooses a password. The server makes one like
 * `anker-falke-wiese-7320`: four different words from the list of the
 * player's language and a four-digit number, all drawn with the operating
 * system's cryptographic random generator. With lists of 700+ words that is
 * more than 50 bits, far beyond what an online attacker gets through the
 * rate limits, and expensive offline because only an Argon2id hash is kept.
 */
import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";
import { WORD_LISTS } from "./words.ts";

export const PASSWORD_WORDS = 4;

/** Longest input we hash at all; generated passwords are far shorter. Stops hashing huge inputs. */
export const MAX_PASSWORD_INPUT = 200;

export function generatePassword(language: string): string {
  const list = WORD_LISTS[language] ?? WORD_LISTS["en"]!;
  const picked: string[] = [];
  while (picked.length < PASSWORD_WORDS) {
    const word = list[randomInt(list.length)]!;
    if (!picked.includes(word)) picked.push(word);
  }
  return [...picked, String(randomInt(1000, 10_000))].join("-");
}

/** Bits of strength of a generated password for a language. */
export function passwordEntropyBits(language: string): number {
  const n = (WORD_LISTS[language] ?? WORD_LISTS["en"]!).length;
  let bits = Math.log2(9000);
  for (let i = 0; i < PASSWORD_WORDS; i++) bits += Math.log2(n - i);
  return bits;
}

/**
 * Typing forgiveness: phones capitalise the first letter, people type
 * spaces instead of dashes. Generated passwords are lowercase words joined
 * by dashes, so folding these differences costs no strength.
 */
export function normalizePassword(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_.,;:+\-‐-―]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Argon2id with the OWASP baseline (19 MiB memory, 2 passes, 1 lane). The
 * library's default algorithm is Argon2id; the PHC string records the
 * parameters, so they can be raised later without breaking old hashes.
 */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), ARGON2);
}

export async function verifyPassword(passwordHash: string, input: string): Promise<boolean> {
  if (input.length > MAX_PASSWORD_INPUT) return false;
  try {
    return await verify(passwordHash, normalizePassword(input));
  } catch {
    return false;
  }
}

/**
 * Hash of a password nobody knows. Logins for unknown addresses verify
 * against it, so they take as long as real ones and do not reveal which
 * addresses have an account.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(generatePassword("en"));
  return dummyHash;
}
