import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_MS } from "../auth/session.ts";
import { Client, passwordFromMail, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;
const EMAIL = "player@example.org";

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
});

const MINUTE = 60_000;

describe("getting a password", () => {
  it("creates an account, mails a generated password in the chosen language, stores only a hash", async () => {
    const res = await client.call("POST", "/api/auth/password", {
      email: "  Player@Example.ORG ",
      language: "de",
    });
    expect(res.status).toBe(202);
    expect(server.mails).toHaveLength(1);
    expect(server.mails[0]!.to).toBe(EMAIL);
    expect(server.mails[0]!.subject).toBe("Dein Passwort für den Charakterbuilder");
    const password = passwordFromMail(server.mails, EMAIL);

    const rows = await server.db.query<{ email: string; password_hash: string; language: string }>(
      "SELECT email, password_hash, language FROM accounts",
    );
    expect(rows).toEqual([
      { email: EMAIL, password_hash: expect.stringMatching(/^\$argon2id\$/), language: "de" },
    ]);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(JSON.stringify(res.json)).not.toContain(password);
  });

  it("answers the same for new and existing addresses", async () => {
    const first = await client.call("POST", "/api/auth/password", { email: EMAIL });
    const again = await client.call("POST", "/api/auth/password", { email: EMAIL });
    expect(again.status).toBe(first.status);
    expect(again.json).toEqual(first.json);
  });

  it("rejects what is not a mail address", async () => {
    const res = await client.call("POST", "/api/auth/password", { email: "not-an-address" });
    expect(res.status).toBe(400);
    expect(server.mails).toHaveLength(0);
  });

  it("stores nothing when the mail cannot be sent", async () => {
    server.failMail.on = true;
    const res = await client.call("POST", "/api/auth/password", { email: EMAIL });
    expect(res.status).toBe(502);
    expect(await server.db.query("SELECT 1 FROM accounts")).toEqual([]);
  });
});

describe("login", () => {
  it("logs in with the mailed password, forgiving case and spaces, and sets a long httpOnly cookie", async () => {
    await client.call("POST", "/api/auth/password", { email: EMAIL });
    const password = passwordFromMail(server.mails, EMAIL);
    const typed = password.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const res = await client.call("POST", "/api/auth/login", { email: EMAIL, password: typed });
    expect(res.status).toBe(200);
    expect(res.json.account).toMatchObject({ email: EMAIL, language: "de", units: {} });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toContain(`Max-Age=${SESSION_MS / 1000}`);
    expect((await client.call("GET", "/api/account")).status).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    await client.call("POST", "/api/auth/password", { email: EMAIL });
    const wrong = await client.call("POST", "/api/auth/login", {
      email: EMAIL,
      password: "anker-falke-wiese-1234",
    });
    const unknown = await client.call("POST", "/api/auth/login", {
      email: "nobody@example.org",
      password: "anker-falke-wiese-1234",
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
  });

  it("logs out and the session no longer works", async () => {
    await signIn(client, server, EMAIL);
    const out = await client.call("POST", "/api/auth/logout");
    expect(out.status).toBe(204);
    expect(client.hasSession).toBe(false);
    expect(await server.db.query("SELECT 1 FROM sessions")).toEqual([]);
  });

  it("keeps a session in use alive and ends an unused one after its lifetime", async () => {
    await signIn(client, server, EMAIL);
    server.advance(SESSION_MS - MINUTE);
    const refreshed = await client.call("GET", "/api/account");
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("set-cookie")).toContain("Max-Age=");
    server.advance(SESSION_MS - MINUTE);
    expect((await client.call("GET", "/api/account")).status).toBe(200);
    server.advance(SESSION_MS + MINUTE);
    expect((await client.call("GET", "/api/account")).status).toBe(401);
    // The dead session is removed at the next login.
    await signIn(new Client(server), server, "other@example.org");
    expect(await server.db.query("SELECT 1 FROM sessions")).toHaveLength(1);
  });
});

describe("reset", () => {
  it("makes a new password; the old one stops working, sessions stay", async () => {
    const old = await signIn(client, server, EMAIL);
    const other = new Client(server);
    expect((await other.call("POST", "/api/auth/password", { email: EMAIL })).status).toBe(202);
    const fresh = passwordFromMail(server.mails, EMAIL);
    expect(fresh).not.toBe(old);
    expect(server.mails.at(-1)!.text).toContain("Das alte funktioniert nicht mehr");

    expect((await other.call("POST", "/api/auth/login", { email: EMAIL, password: old })).status).toBe(401);
    expect((await other.call("POST", "/api/auth/login", { email: EMAIL, password: fresh })).status).toBe(200);
    // Anyone can ask for a reset, so it must not log the owner out.
    expect((await client.call("GET", "/api/account")).status).toBe(200);
  });

  it("from the settings: new password, and every other session ends", async () => {
    await signIn(client, server, EMAIL);
    const phone = new Client(server, "198.51.100.20");
    const old = passwordFromMail(server.mails, EMAIL);
    await phone.call("POST", "/api/auth/login", { email: EMAIL, password: old });
    expect((await phone.call("GET", "/api/account")).status).toBe(200);

    expect((await client.call("POST", "/api/account/password")).status).toBe(202);
    expect(passwordFromMail(server.mails, EMAIL)).not.toBe(old);
    expect((await client.call("GET", "/api/account")).status).toBe(200);
    expect((await phone.call("GET", "/api/account")).status).toBe(401);
  });
});

describe("rate limits", () => {
  it("slows down guessing per account, even from many addresses, and lets the owner in later", async () => {
    await client.call("POST", "/api/auth/password", { email: EMAIL });
    const password = passwordFromMail(server.mails, EMAIL);
    for (let i = 0; i < 10; i++) {
      const guesser = new Client(server, `192.0.2.${i}`);
      expect(
        (await guesser.call("POST", "/api/auth/login", { email: EMAIL, password: `x-y-z-w-${i}000` })).status,
      ).toBe(401);
    }
    const blocked = await client.call("POST", "/api/auth/login", { email: EMAIL, password });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe("tooManyAttempts");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    server.advance(15 * MINUTE + 1000);
    expect((await client.call("POST", "/api/auth/login", { email: EMAIL, password })).status).toBe(200);
  });

  it("slows down one address trying many accounts", async () => {
    const attacker = new Client(server, "192.0.2.66");
    for (let i = 0; i < 30; i++) {
      await attacker.call("POST", "/api/auth/login", {
        email: `user${i}@example.org`,
        password: "a-b-c-d-1234",
      });
    }
    const res = await attacker.call("POST", "/api/auth/login", {
      email: "user99@example.org",
      password: "a-b-c-d-1234",
    });
    expect(res.status).toBe(429);
    // Someone else is not affected.
    expect(
      (
        await client.call("POST", "/api/auth/login", {
          email: "user99@example.org",
          password: "a-b-c-d-1234",
        })
      ).status,
    ).toBe(401);
  });

  it("limits password mails per account and per address", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (await new Client(server, `192.0.2.${i}`).call("POST", "/api/auth/password", { email: EMAIL }))
          .status,
      ).toBe(202);
    }
    expect((await client.call("POST", "/api/auth/password", { email: EMAIL })).status).toBe(429);
    expect(server.mails).toHaveLength(3);

    const spammer = new Client(server, "192.0.2.99");
    for (let i = 0; i < 10; i++) {
      await spammer.call("POST", "/api/auth/password", { email: `victim${i}@example.org` });
    }
    expect((await spammer.call("POST", "/api/auth/password", { email: "victim10@example.org" })).status).toBe(
      429,
    );
  });
});

describe("settings", () => {
  it("stores language and units on the account; units follow the language until chosen", async () => {
    await signIn(client, server, EMAIL, "de");
    const set = await client.call("PATCH", "/api/account/settings", {
      language: "en",
      units: { length: "m" },
    });
    expect(set.status).toBe(200);
    expect(set.json.account).toMatchObject({ language: "en", units: { length: "m" } });
    // Stored as a JSON object, not as a JSON string holding one.
    const stored = await server.db.query<{ t: string }>("SELECT jsonb_typeof(units) AS t FROM accounts");
    expect(stored).toEqual([{ t: "object" }]);
    const back = await client.call("PATCH", "/api/account/settings", { units: { length: null } });
    expect(back.json.account.units).toEqual({});
  });

  it("accepts only units a loaded package offers for that dimension, and only known languages", async () => {
    await signIn(client, server, EMAIL);
    const unit = await client.call("PATCH", "/api/account/settings", { units: { length: "kg" } });
    expect(unit.status).toBe(422);
    expect(unit.json.error).toEqual({ code: "unknownUnit", dimension: "length", unit: "kg" });
    expect((await client.call("PATCH", "/api/account/settings", { language: "xx" })).status).toBe(400);
  });

  it("keeps the last download's choice: sheet, cards and play state until something else is picked", async () => {
    await signIn(client, server, EMAIL);
    const fresh = await client.call("GET", "/api/account");
    expect(fresh.json.account.print).toEqual({
      parts: ["sheet", "cards"],
      design: "verbose",
      state: "filled",
    });

    // Parts are kept in file order; what is left out stays as it was.
    const set = await client.call("PATCH", "/api/account/settings", { print: { parts: ["texts", "sheet"] } });
    expect(set.status).toBe(200);
    expect(set.json.account.print).toEqual({ parts: ["sheet", "texts"], design: "verbose", state: "filled" });
    // A choice kept with the sheet alone, empty, stays so.
    const kept = await client.call("PATCH", "/api/account/settings", {
      print: { parts: ["sheet"], state: "empty" },
    });
    expect(kept.json.account.print).toEqual({ parts: ["sheet"], design: "verbose", state: "empty" });
    expect((await client.call("GET", "/api/account")).json.account.print).toEqual(kept.json.account.print);
    await client.call("PATCH", "/api/account/settings", { print: { parts: ["texts", "sheet"] } });
    const language = await client.call("PATCH", "/api/account/settings", { language: "en" });
    expect(language.json.account.print.parts).toEqual(["sheet", "texts"]);
    expect((await client.call("GET", "/api/account")).json.account.print.parts).toEqual(["sheet", "texts"]);

    const refuse = async (print: unknown) =>
      (await client.call("PATCH", "/api/account/settings", { print })).status;
    expect(await refuse({ parts: [] })).toBe(400);
    expect(await refuse({ parts: ["sheet", "sheet"] })).toBe(400);
    expect(await refuse({ parts: ["poster"] })).toBe(400);
    expect(await refuse({ design: "fancy" })).toBe(400);
    expect(await refuse({ colour: "red" })).toBe(400);
    const classic = await client.call("PATCH", "/api/account/settings", { print: { design: "classic" } });
    expect(classic.status).toBe(200);
    expect(classic.json.account.print.design).toBe("classic");

    // Whatever got into the column, the account reads only what is valid now.
    await server.db.query(
      `UPDATE accounts SET print_choice = '{"parts":["cards","nope"],"design":"gone","state":"filled"}'`,
    );
    expect((await client.call("GET", "/api/account")).json.account.print).toEqual({
      parts: ["sheet", "cards"],
      design: "verbose",
      state: "filled",
    });
    await server.db.query(`UPDATE accounts SET print_choice = '{"state":"empty"}'`);
    expect((await client.call("GET", "/api/account")).json.account.print.state).toBe("empty");
  });
});

describe("deleting the account", () => {
  it("deletes everything: account, sessions and drafts", async () => {
    const password = await signIn(client, server, EMAIL);
    await client.call("POST", "/api/drafts", { packageId: "demo" });
    expect((await client.call("DELETE", "/api/account", { confirm: false })).status).toBe(400);

    const res = await client.call("DELETE", "/api/account", { confirm: true });
    expect(res.status).toBe(204);
    for (const table of ["accounts", "sessions", "drafts"]) {
      expect(await server.db.query(`SELECT 1 FROM ${table}`), table).toEqual([]);
    }
    expect(client.hasSession).toBe(false);
    expect((await client.call("POST", "/api/auth/login", { email: EMAIL, password })).status).toBe(401);
  });
});

describe("request guards", () => {
  it("needs a session for personal data", async () => {
    expect((await client.call("GET", "/api/account")).status).toBe(401);
    expect((await client.call("GET", "/api/drafts")).status).toBe(401);
    expect((await client.call("GET", "/api/packages/demo")).status).toBe(401);
  });

  it("refuses changes from other sites and bodies that are not JSON", async () => {
    await signIn(client, server, EMAIL);
    const cross = await client.call(
      "POST",
      "/api/drafts",
      { packageId: "demo" },
      { origin: "https://evil.example" },
    );
    expect(cross.status).toBe(403);
    const form = await client.call("POST", "/api/drafts", "packageId=demo", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(form.status).toBe(415);
  });

  it("answers unknown paths and methods with JSON errors", async () => {
    expect((await client.call("GET", "/api/nope")).json.error.code).toBe("notFound");
    expect((await client.call("PUT", "/api/drafts")).json.error.code).toBe("methodNotAllowed");
  });
});
