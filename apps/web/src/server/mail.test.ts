import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "./auth/accounts.ts";
import { resetMail } from "./mail.ts";

const link = { name: "Mira", url: "https://example.test/reset#a" };

describe("the mail with the link back in", () => {
  it.each(UI_LANGUAGES)("%s: its own words, the link and the minutes", (lang) => {
    const mail = resetMail(lang, "a@example.test", [link], 30);
    expect(mail.subject).not.toBe("");
    // The name on a line of its own, in quotes; the link alone on the next line.
    const lines = mail.text.split("\n");
    const at = lines.indexOf("https://example.test/reset#a");
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toMatch(/^\S+ [„“«] ?Mira ?[“”»]$/u);
    expect(lines[at - 1]).not.toContain("https://");
    expect(mail.text).toContain("30");
    if (lang !== "en") expect(mail.subject).not.toBe(resetMail("en", "a@example.test", [link], 30).subject);
  });

  it("speaks of several links when the address has several accounts", () => {
    const one = resetMail("fr", "a@example.test", [link], 30).text;
    const two = resetMail("fr", "a@example.test", [link, { ...link, name: "Robin" }], 30).text;
    expect(one).not.toBe(two.replace("\nCompte « Robin »\nhttps://example.test/reset#a\n", ""));
    expect(two).toContain("Compte « Mira »\nhttps://example.test/reset#a\n\nCompte « Robin »\n");
  });

  it("de: the account in German quotes above its link", () => {
    expect(resetMail("de", "a@example.test", [link], 30).text).toContain(
      "Konto „Mira“\nhttps://example.test/reset#a\n",
    );
  });

  it("falls back to English for a language it has no words for", () => {
    expect(resetMail("xx", "a@example.test", [link], 30)).toEqual(
      resetMail("en", "a@example.test", [link], 30),
    );
  });
});
