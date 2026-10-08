import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "./auth/accounts.ts";
import { resetMail } from "./mail.ts";

const link = { name: "Mira", url: "https://example.test/reset#a" };

describe("the mail with the link back in", () => {
  it.each(UI_LANGUAGES)("%s: its own words, the link and the minutes", (lang) => {
    const mail = resetMail(lang, "a@example.test", [link], 30);
    expect(mail.subject).not.toBe("");
    expect(mail.text).toContain("Mira: https://example.test/reset#a");
    expect(mail.text).toContain("30");
    if (lang !== "en") expect(mail.subject).not.toBe(resetMail("en", "a@example.test", [link], 30).subject);
  });

  it("speaks of several links when the address has several accounts", () => {
    const one = resetMail("fr", "a@example.test", [link], 30).text;
    const two = resetMail("fr", "a@example.test", [link, { ...link, name: "Robin" }], 30).text;
    expect(one).not.toBe(two.replace("\nRobin: https://example.test/reset#a", ""));
  });

  it("falls back to English for a language it has no words for", () => {
    expect(resetMail("xx", "a@example.test", [link], 30)).toEqual(resetMail("en", "a@example.test", [link], 30));
  });
});
