import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_MS } from "../auth/session.ts";
import { hashPassword } from "../auth/password.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;
const EMAIL = "player@example.org";

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
});

const MINUTE = 60_000;

describe("signing up", () => {
  it("makes an account with a name and no address, shows the password once, logs in at once", async () => {
    const res = await client.call("POST", "/api/auth/signup", { name: "  Mira ", language: "de" });
    expect(res.status).toBe(201);
    expect(res.json.account).toMatchObject({ name: "Mira", email: null, language: "de", units: {} });
    expect(res.json.password).toEqual({
      id: expect.any(String),
      name: "2026-10-04",
      createdAt: "2026-10-04T10:00:00.000Z",
      secret: expect.stringMatching(/^[a-z]+(?:-[a-z]+){4}-\d{4}$/),
    });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toContain(`Max-Age=${SESSION_MS / 1000}`);
    expect((await client.call("GET", "/api/account")).json.account.name).toBe("Mira");
    expect(server.mails).toEqual([]);

    // Only a hash is kept: the plain password is in that one answer and nowhere else.
    const secret: string = res.json.password.secret;
    const dump = JSON.stringify([
      await server.db.query("SELECT * FROM accounts"),
      await server.db.query("SELECT * FROM passwords"),
    ]);
    expect(dump).not.toContain(secret);
    expect(await server.db.query("SELECT password_hash FROM accounts")).toEqual([{ password_hash: null }]);
  });

  it("keeps an address if one is given, normalised; two accounts may give the same one", async () => {
    const first = await client.call("POST", "/api/auth/signup", { name: "A", email: " Player@Example.ORG " });
    expect(first.json.account.email).toBe(EMAIL);
    const second = await new Client(server).call("POST", "/api/auth/signup", { name: "B", email: EMAIL });
    expect(second.status).toBe(201);
    expect(second.json.account.email).toBe(EMAIL);
  });

  it("refuses an empty name, a name with line breaks and what is not a mail address", async () => {
    const refuse = async (body: unknown) => (await client.call("POST", "/api/auth/signup", body)).status;
    expect(await refuse({ name: "  " })).toBe(400);
    expect(await refuse({ name: "a\nb" })).toBe(400);
    expect(await refuse({ name: "x".repeat(81) })).toBe(400);
    expect(await refuse({ name: "A", email: "not-an-address" })).toBe(400);
    expect(await server.db.query("SELECT 1 FROM accounts")).toEqual([]);
  });

  it("limits new accounts per IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await client.call("POST", "/api/auth/signup", { name: `P${i}` })).status).toBe(201);
    }
    const res = await client.call("POST", "/api/auth/signup", { name: "P10" });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("tooManyAttempts");
    expect(
      (await new Client(server, "198.51.100.1").call("POST", "/api/auth/signup", { name: "Q" })).status,
    ).toBe(201);
  });
});

describe("login", () => {
  it("logs in with the password alone, forgiving case and spaces, on another device", async () => {
    const password = await signIn(client, EMAIL);
    const phone = new Client(server, "198.51.100.20");
    const typed = password.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const res = await phone.call("POST", "/api/auth/login", { password: typed });
    expect(res.status).toBe(200);
    expect(res.json.account).toMatchObject({ name: "player", email: EMAIL });
    expect(res.headers.get("set-cookie")).toContain(`Max-Age=${SESSION_MS / 1000}`);
    expect((await phone.call("GET", "/api/account")).status).toBe(200);
  });

  it("refuses a wrong password with 401", async () => {
    await signIn(client, EMAIL);
    const res = await new Client(server).call("POST", "/api/auth/login", {
      password: "anker-falke-wiese-ofen-dach-1234",
    });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("wrongPassword");
    // An address is no way in anymore.
    expect((await client.call("POST", "/api/auth/login", { email: EMAIL, password: "x" })).status).toBe(400);
  });

  it("logs out and the session no longer works", async () => {
    await signIn(client, EMAIL);
    const out = await client.call("POST", "/api/auth/logout");
    expect(out.status).toBe(204);
    expect(client.hasSession).toBe(false);
    expect(await server.db.query("SELECT 1 FROM sessions")).toEqual([]);
  });

  it("keeps a session in use alive and ends an unused one after its lifetime", async () => {
    await signIn(client, EMAIL);
    server.advance(SESSION_MS - MINUTE);
    const refreshed = await client.call("GET", "/api/account");
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("set-cookie")).toContain("Max-Age=");
    server.advance(SESSION_MS - MINUTE);
    expect((await client.call("GET", "/api/account")).status).toBe(200);
    server.advance(SESSION_MS + MINUTE);
    expect((await client.call("GET", "/api/account")).status).toBe(401);
    // The dead session is removed at the next login.
    await signIn(new Client(server), "other@example.org");
    expect(await server.db.query("SELECT 1 FROM sessions")).toHaveLength(1);
  });
});

describe("own passwords", () => {
  it("makes a second password, deletes the first, logs in with the second; the last one stays", async () => {
    const first = await signIn(client, EMAIL);
    server.advance(MINUTE);
    const made = await client.call("POST", "/api/account/passwords", { name: "Phone" });
    expect(made.status).toBe(201);
    expect(made.json.password).toMatchObject({ name: "Phone", secret: expect.any(String) });
    const second: string = made.json.password.secret;
    expect(second).not.toBe(first);

    const list = (await client.call("GET", "/api/account/passwords")).json.passwords;
    expect(list.map((p: { name: string }) => p.name)).toEqual(["2026-10-04", "Phone"]);
    expect(JSON.stringify(list)).not.toContain(second);

    expect((await client.call("DELETE", `/api/account/passwords/${list[0].id}`)).status).toBe(204);
    const other = new Client(server);
    expect((await other.call("POST", "/api/auth/login", { password: first })).status).toBe(401);
    expect((await other.call("POST", "/api/auth/login", { password: second })).status).toBe(200);

    const last = await client.call("DELETE", `/api/account/passwords/${list[1].id}`);
    expect(last.status).toBe(422);
    expect(last.json.error.code).toBe("lastPassword");
    expect((await other.call("POST", "/api/auth/login", { password: second })).status).toBe(200);
  });

  it("names a password by its day when none is given, and keeps at most ten", async () => {
    await signIn(client, EMAIL);
    const made = await client.call("POST", "/api/account/passwords", {});
    expect(made.json.password.name).toBe("2026-10-04");
    for (let i = 2; i < 10; i++)
      expect((await client.call("POST", "/api/account/passwords", {})).status).toBe(201);
    const full = await client.call("POST", "/api/account/passwords", {});
    expect(full.status).toBe(422);
    expect(full.json.error).toEqual({ code: "tooManyPasswords", max: 10 });
    expect((await client.call("POST", "/api/account/passwords", { name: "a\nb" })).status).toBe(400);
  });

  it("someone else's password looks missing; an access key cannot make one", async () => {
    await signIn(client, EMAIL);
    const theirs = new Client(server, "198.51.100.30");
    await signIn(theirs, "other@example.org");
    const id = (await theirs.call("GET", "/api/account/passwords")).json.passwords[0].id;
    expect((await client.call("DELETE", `/api/account/passwords/${id}`)).status).toBe(404);
    expect((await client.call("DELETE", "/api/account/passwords/nope")).status).toBe(404);

    const key = (await client.call("POST", "/api/account/keys", { name: "Tool" })).json.key.secret;
    const tool = new Client(server);
    const res = await tool.call("POST", "/api/account/passwords", {}, { authorization: `Bearer ${key}` });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("keyCannotMakePasswords");
  });
});

describe("accounts from before", () => {
  const OLD = "anker-falke-wiese-7320";
  async function oldAccount() {
    await server.db.query(
      `INSERT INTO accounts (id, name, email, password_hash, language, created_at)
       VALUES ('00000000-0000-4000-8000-000000000001', 'player', $1, $2, 'de', now())`,
      [EMAIL, await hashPassword(OLD)],
    );
  }

  it("log in once with address and password and get a new password; only that works then", async () => {
    await oldAccount();
    const res = await client.call("POST", "/api/auth/legacy-login", {
      email: EMAIL,
      password: "Anker Falke wiese 7320",
    });
    expect(res.status).toBe(200);
    expect(res.json.account).toMatchObject({ name: "player", email: EMAIL });
    const fresh: string = res.json.password.secret;
    expect(fresh).toMatch(/^[a-z]+(?:-[a-z]+){4}-\d{4}$/);
    expect((await client.call("GET", "/api/account")).status).toBe(200);
    expect(await server.db.query("SELECT password_hash FROM accounts")).toEqual([{ password_hash: null }]);

    const other = new Client(server);
    expect((await other.call("POST", "/api/auth/legacy-login", { email: EMAIL, password: OLD })).status).toBe(
      401,
    );
    expect((await other.call("POST", "/api/auth/login", { password: OLD })).status).toBe(401);
    expect((await other.call("POST", "/api/auth/login", { password: fresh })).status).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    await oldAccount();
    const wrong = await client.call("POST", "/api/auth/legacy-login", {
      email: EMAIL,
      password: "a-b-c-d-1234",
    });
    const unknown = await client.call("POST", "/api/auth/legacy-login", {
      email: "nobody@example.org",
      password: "a-b-c-d-1234",
    });
    expect(wrong.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
    // A new account with the same address has no old password to log in with.
    await signIn(new Client(server), "new@example.org");
    const fresh = await client.call("POST", "/api/auth/legacy-login", {
      email: "new@example.org",
      password: "a-b-c-d-1234",
    });
    expect(fresh.status).toBe(401);
  });

  it("slow down guessing per address, even from many IPs, and let the owner in later", async () => {
    await oldAccount();
    for (let i = 0; i < 10; i++) {
      const guesser = new Client(server, `192.0.2.${i}`);
      const r = await guesser.call("POST", "/api/auth/legacy-login", {
        email: EMAIL,
        password: `x-y-z-w-${i}000`,
      });
      expect(r.status).toBe(401);
    }
    const blocked = await client.call("POST", "/api/auth/legacy-login", { email: EMAIL, password: OLD });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    server.advance(15 * MINUTE + 1000);
    expect(
      (await client.call("POST", "/api/auth/legacy-login", { email: EMAIL, password: OLD })).status,
    ).toBe(200);
  });
});

describe("rate limits", () => {
  it("slows down one IP guessing passwords; someone else is not affected", async () => {
    const password = await signIn(client, EMAIL);
    const attacker = new Client(server, "192.0.2.66");
    for (let i = 0; i < 30; i++) {
      const r = await attacker.call("POST", "/api/auth/login", { password: `a-b-c-d-e-${1000 + i}` });
      expect(r.status).toBe(401);
    }
    const res = await attacker.call("POST", "/api/auth/login", { password });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("tooManyAttempts");
    expect((await new Client(server).call("POST", "/api/auth/login", { password })).status).toBe(200);
    server.advance(15 * MINUTE + 1000);
    expect((await attacker.call("POST", "/api/auth/login", { password })).status).toBe(200);
  });
});

describe("settings", () => {
  it("changes name and address; null removes the address", async () => {
    await signIn(client, EMAIL);
    const set = await client.call("PATCH", "/api/account/settings", {
      name: "Mira",
      email: "Mira@Example.org",
    });
    expect(set.status).toBe(200);
    expect(set.json.account).toMatchObject({ name: "Mira", email: "mira@example.org", language: "de" });
    const removed = await client.call("PATCH", "/api/account/settings", { email: null });
    expect(removed.json.account).toMatchObject({ name: "Mira", email: null });
    expect((await client.call("PATCH", "/api/account/settings", { name: "" })).status).toBe(400);
    expect((await client.call("PATCH", "/api/account/settings", { email: "nope" })).status).toBe(400);
  });

  it("stores language and units on the account; units follow the language until chosen", async () => {
    await signIn(client, EMAIL, "de");
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
    await signIn(client, EMAIL);
    const unit = await client.call("PATCH", "/api/account/settings", { units: { length: "kg" } });
    expect(unit.status).toBe(422);
    expect(unit.json.error).toEqual({ code: "unknownUnit", dimension: "length", unit: "kg" });
    expect((await client.call("PATCH", "/api/account/settings", { language: "xx" })).status).toBe(400);
  });

  it("keeps the last download's choice: sheet, cards and play state until something else is picked", async () => {
    await signIn(client, EMAIL);
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
  it("deletes everything: account, sessions, passwords and drafts", async () => {
    const password = await signIn(client, EMAIL);
    await client.call("POST", "/api/drafts", { packageId: "demo" });
    expect((await client.call("DELETE", "/api/account", { confirm: false })).status).toBe(400);

    const res = await client.call("DELETE", "/api/account", { confirm: true });
    expect(res.status).toBe(204);
    for (const table of ["accounts", "sessions", "passwords", "drafts"]) {
      expect(await server.db.query(`SELECT 1 FROM ${table}`), table).toEqual([]);
    }
    expect(client.hasSession).toBe(false);
    expect((await client.call("POST", "/api/auth/login", { password })).status).toBe(401);
  });
});

describe("request guards", () => {
  it("needs a session for personal data", async () => {
    expect((await client.call("GET", "/api/account")).status).toBe(401);
    expect((await client.call("GET", "/api/drafts")).status).toBe(401);
    expect((await client.call("GET", "/api/packages/demo")).status).toBe(401);
  });

  it("refuses changes from other sites and bodies that are not JSON", async () => {
    await signIn(client, EMAIL);
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
