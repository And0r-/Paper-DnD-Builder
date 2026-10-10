import { describe, expect, it } from "vitest";
import { accountNameSchema, nameSchema } from "../server/auth/accounts.ts";
import { isAccountName, MAX_ACCOUNT_NAME } from "./account-name.ts";

const allowed = [
  "J.R.R. Tolkien",
  "Dr. Müller",
  "Anna-Lena",
  "Spielleiter Nr. 2",
  "Zoë Ångström",
  "François Pérez",
  "Mira",
  "  Mira  ",
  "x".repeat(MAX_ACCOUNT_NAME),
];

const refused = [
  "",
  "   ",
  "x".repeat(MAX_ACCOUNT_NAME + 1),
  "example.com",
  "Your bank: bit.ly/abc",
  "bank.ch",
  "web3.io",
  "St.Gallen",
  "Login at EXAMPLE.COM now",
  "https://x",
  "hxxp://x",
  "www.x",
  "WWW.x",
  "someone@somewhere",
  "a@b",
  "example．com", // a full-width dot
  "someone＠somewhere", // a full-width @
  "Mira\u0000",
  "Mira\nUrgent: your account",
  "Mira‮", // a direction override
];

describe("an account's name", () => {
  it.each(allowed)("allows %j", (name) => {
    expect(isAccountName(name)).toBe(true);
    expect(accountNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(refused)("refuses %j", (name) => {
    expect(isAccountName(name)).toBe(false);
    expect(accountNameSchema.safeParse(name).success).toBe(false);
  });

  it("is trimmed", () => {
    expect(accountNameSchema.parse("  Mira  ")).toBe("Mira");
  });

  it("leaves the other names as they were: up to 80 characters, dots and all", () => {
    expect(nameSchema.safeParse("x".repeat(80)).success).toBe(true);
    expect(nameSchema.safeParse("Campaign at example.com").success).toBe(true);
    expect(nameSchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});
