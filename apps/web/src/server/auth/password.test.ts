import { describe, expect, it } from "vitest";
import {
  generatePassword,
  hashPassword,
  normalizePassword,
  passwordEntropyBits,
  passwordHash,
  verifyPassword,
} from "./password.ts";
import { UI_LANGUAGES } from "./accounts.ts";
import { RateLimiter } from "./rate-limit.ts";
import { WORD_LISTS } from "./words.ts";

describe("word lists", () => {
  it("exist for every screen language", () => {
    expect(Object.keys(WORD_LISTS).sort()).toEqual([...UI_LANGUAGES].sort());
  });

  it.each(Object.entries(WORD_LISTS))("%s: 700+ different plain lowercase words", (_, words) => {
    expect(words.length).toBeGreaterThanOrEqual(700);
    expect(new Set(words).size).toBe(words.length);
    for (const w of words) expect(w).toMatch(/^[a-z]{3,10}$/);
  });
});

describe("generatePassword", () => {
  it("makes five different words from the language's list and a four-digit number", () => {
    for (const lang of UI_LANGUAGES) {
      for (let i = 0; i < 50; i++) {
        const pw = generatePassword(lang);
        const parts = pw.split("-");
        expect(parts).toHaveLength(6);
        const words = parts.slice(0, 5);
        expect(new Set(words).size).toBe(5);
        for (const w of words) expect(WORD_LISTS[lang]).toContain(w);
        expect(parts[5]).toMatch(/^[1-9]\d{3}$/);
      }
    }
  });

  it("is not predictable: no repeats in many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generatePassword("en")));
    expect(seen.size).toBe(2000);
  });

  it("is strong enough to be found by an unsalted hash: about 60 bits", () => {
    for (const lang of UI_LANGUAGES) expect(passwordEntropyBits(lang), lang).toBeGreaterThan(59);
  });

  it("falls back to English words for a language without a list", () => {
    const first = generatePassword("xx").split("-")[0]!;
    expect(WORD_LISTS["en"]).toContain(first);
  });
});

describe("normalizePassword", () => {
  it("forgives what phones and people do to a typed password", () => {
    expect(normalizePassword(" Anker Falke  wiese_7320 ")).toBe("anker-falke-wiese-7320");
    expect(normalizePassword("anker–falke—wiese-7320")).toBe("anker-falke-wiese-7320");
  });
});

describe("hashing", () => {
  it("finds a password by the SHA-256 of its normalised form, forgiving what people type", () => {
    const pw = generatePassword("de");
    const h = passwordHash(pw);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(pw);
    expect(passwordHash(` ${pw.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())} `)).toBe(h);
    expect(passwordHash(`${pw}x`)).not.toBe(h);
  });

  it("keeps Argon2id for passwords from before, with a fresh salt, verifying only the right one", async () => {
    const pw = generatePassword("de");
    const a = await hashPassword(pw);
    const b = await hashPassword(pw);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(pw);
    expect(await verifyPassword(a, pw)).toBe(true);
    expect(await verifyPassword(a, pw.toUpperCase())).toBe(true);
    expect(await verifyPassword(a, `${pw}x`)).toBe(false);
    expect(await verifyPassword(a, "x".repeat(10_000))).toBe(false);
    expect(await verifyPassword("not a hash", pw)).toBe(false);
  });
});

describe("RateLimiter", () => {
  const limit = { max: 3, windowMs: 1000 };

  it("allows up to the limit within the window, then says when to retry", () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(rl.take("k", limit).ok).toBe(true);
    t = 400;
    expect(rl.take("k", limit)).toEqual({ ok: false, retryAfter: 1 });
    expect(rl.check("other", limit).ok).toBe(true);
  });

  it("forgets events once they leave the window", () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 3; i++) rl.record("k", limit);
    expect(rl.check("k", limit).ok).toBe(false);
    t = 1001;
    expect(rl.check("k", limit).ok).toBe(true);
  });

  it("checks without recording, and resets", () => {
    const rl = new RateLimiter(() => 0);
    for (let i = 0; i < 10; i++) expect(rl.check("k", limit).ok).toBe(true);
    for (let i = 0; i < 3; i++) rl.record("k", limit);
    rl.reset("k");
    expect(rl.check("k", limit).ok).toBe(true);
  });
});
