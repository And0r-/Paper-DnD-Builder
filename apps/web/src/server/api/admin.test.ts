/**
 * The admin (AND-353): the first one made at start, its known password
 * swapped at its first login, and the routes that look after accounts,
 * open only to an admin in the browser.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstAdmin, DEFAULT_ADMIN_PASSWORD } from "../auth/accounts.ts";
import { readConfig } from "../config.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  server = await startTestServer();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
});

/** An environment with only these variables. */
const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

const admins = async () =>
  (await server.db.query<{ id: string }>("SELECT id FROM accounts WHERE role = 'admin'")).length;

/** The first admin, logged in with its known password; returns its new one. */
async function firstAdmin(client: Client = new Client(server, "198.51.100.1")): Promise<string> {
  await createFirstAdmin(server.app);
  const res = await client.call("POST", "/api/auth/login", {
    login: "admin",
    password: DEFAULT_ADMIN_PASSWORD,
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json.password.secret as string;
}

/** A player with an access key; returns the account id and the key. */
async function player(client: Client, email: string) {
  await signIn(client, email);
  const key = (await client.call("POST", "/api/account/keys", { name: "Laptop" })).json.key.secret as string;
  const list = await adminList(`?q=${encodeURIComponent(email)}`);
  return { id: list.accounts[0].id as string, key };
}

let admin: Client;
async function adminList(query = "") {
  const res = await admin.call("GET", `/api/admin/accounts${query}`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json;
}

describe("the first admin", () => {
  it("is made once, while there is no admin, with the known password", async () => {
    expect(await createFirstAdmin(server.app)).toBe(true);
    expect(await createFirstAdmin(server.app)).toBe(false);
    const rows = await server.db.query<{
      name: string;
      email: string | null;
      language: string;
      origin: string;
    }>(
      `SELECT a.name, a.email, a.language, p.origin FROM accounts a JOIN passwords p ON p.account_id = a.id
       WHERE a.role = 'admin'`,
    );
    expect(rows).toEqual([{ name: "admin", email: null, language: "de", origin: "bootstrap" }]);
    expect(log).toHaveBeenCalledWith("Admin: Admin-Konto angelegt. Melde dich an und wechsle das Passwort.");
    const steps = await server.db.query("SELECT id FROM startup_steps WHERE id = 'bootstrap-admin'");
    expect(steps).toHaveLength(1);
  });

  it("is not made when there already is an admin, after its login too", async () => {
    admin = new Client(server);
    await firstAdmin(admin);
    expect(await createFirstAdmin(server.app)).toBe(false);
    expect(await admins()).toBe(1);
  });

  it("is not made when an account was made admin some other way", async () => {
    const c = new Client(server);
    await signIn(c, "owner@example.org");
    await server.db.query("UPDATE accounts SET role = 'admin'");
    expect(await createFirstAdmin(server.app)).toBe(false);
    expect(await admins()).toBe(1);
  });

  it("takes ADMIN_PASSWORD when it is set, and logs nothing then", async () => {
    const own = "unser-eigenes-start-wort-77";
    server.app.config.adminPassword = readConfig(env({ ADMIN_PASSWORD: own })).adminPassword!;
    await createFirstAdmin(server.app);
    expect(log).not.toHaveBeenCalled();
    const c = new Client(server);
    const known = await c.call("POST", "/api/auth/login", {
      login: "admin",
      password: DEFAULT_ADMIN_PASSWORD,
    });
    expect(known.status).toBe(401);
    const res = await c.call("POST", "/api/auth/login", { login: "admin", password: own });
    expect(res.status).toBe(200);
    expect(res.json.password.secret).toEqual(expect.any(String));
  });

  it("refuses an ADMIN_PASSWORD too short to be one", () => {
    expect(() => readConfig(env({ ADMIN_PASSWORD: "admin" }))).toThrow(/ADMIN_PASSWORD/);
    expect(readConfig(env({ ADMIN_PASSWORD: " " })).adminPassword).toBeUndefined();
  });

  it("swaps the known password at the first login: a new one shown once, the known one dead", async () => {
    await createFirstAdmin(server.app);
    const c = new Client(server);
    const res = await c.call("POST", "/api/auth/login", { login: "Admin", password: DEFAULT_ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json.account).toMatchObject({ name: "admin", role: "admin", email: null });
    expect(res.json.password).toMatchObject({ origin: "reset", name: null, secret: expect.any(String) });
    expect(res.headers.get("set-cookie")).toBeTruthy();
    const passwords = await c.call("GET", "/api/account/passwords");
    expect(passwords.json.passwords).toHaveLength(1);
    expect(passwords.json.passwords[0].origin).toBe("reset");

    const again = await new Client(server).call("POST", "/api/auth/login", {
      login: "admin",
      password: DEFAULT_ADMIN_PASSWORD,
    });
    expect(again.status).toBe(401);
    const fresh = await new Client(server).call("POST", "/api/auth/login", {
      login: "admin",
      password: res.json.password.secret,
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.password).toBeUndefined();
  });

  it("lets only one of two logins at once through with the known password", async () => {
    await createFirstAdmin(server.app);
    const both = await Promise.all(
      ["198.51.100.2", "198.51.100.3"].map((ip) =>
        new Client(server, ip).call("POST", "/api/auth/login", {
          login: "admin",
          password: DEFAULT_ADMIN_PASSWORD,
        }),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe("the admin routes", () => {
  let other: Client;
  let theirs: { id: string; key: string };
  let adminKey: string;

  beforeEach(async () => {
    admin = new Client(server, "198.51.100.1");
    await firstAdmin(admin);
    adminKey = (await admin.call("POST", "/api/account/keys", { name: "Admin laptop" })).json.key.secret;
    server.advance(1000);
    other = new Client(server, "198.51.100.4");
    theirs = await player(other, "player@example.org");
  });

  const routes = (id: string) =>
    [
      ["GET", "/api/admin/accounts", undefined],
      ["PATCH", `/api/admin/accounts/${id}/role`, { role: "admin" }],
      ["POST", `/api/admin/accounts/${id}/logout-all`, undefined],
      ["DELETE", `/api/admin/accounts/${id}`, undefined],
    ] as const;

  it("answer 401 without a login", async () => {
    for (const [method, path, body] of routes(theirs.id)) {
      const res = await new Client(server).call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.json.error.code).toBe("notLoggedIn");
    }
  });

  it("answer 403 to a player", async () => {
    for (const [method, path, body] of routes(theirs.id)) {
      const res = await other.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error.code).toBe("adminOnly");
    }
  });

  it("answer 403 to an access key, an admin's too", async () => {
    for (const key of [adminKey, theirs.key]) {
      for (const [method, path, body] of routes(theirs.id)) {
        // A tool: the key and no cookie.
        const res = await new Client(server).call(method, path, body, { authorization: `Bearer ${key}` });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.json.error.code).toBe("keyCannotAdmin");
      }
    }
    // Still a player, still there.
    expect((await adminList()).accounts.find((a: { id: string }) => a.id === theirs.id).role).toBe("player");
  });

  it("refuse changes from another site", async () => {
    const res = await admin.call("DELETE", `/api/admin/accounts/${theirs.id}`, undefined, {
      origin: "https://elsewhere.example",
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("crossSite");
  });

  it("list accounts newest first, with what they have, and find them by a part of name or address", async () => {
    await other.call("POST", "/api/drafts", { packageId: "demo" });
    await other.call("POST", "/api/drafts", { packageId: "demo" });
    await other.call("POST", "/api/campaigns", { name: "Runde" });
    server.advance(1000);
    const third = new Client(server, "198.51.100.5");
    await third.call("POST", "/api/auth/signup", { name: "Zoë 100%_sure", language: "fr" });

    const all = await adminList();
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(all.accounts.map((a: { name: string }) => a.name)).toEqual(["Zoë 100%_sure", "player", "admin"]);
    expect(all.accounts[1]).toEqual({
      id: theirs.id,
      name: "player",
      email: "player@example.org",
      language: "de",
      role: "player",
      createdAt: "2026-10-04T10:00:01.000Z",
      drafts: 2,
      campaigns: 1,
      self: false,
    });
    expect(all.accounts[2]).toMatchObject({ name: "admin", email: null, role: "admin", self: true });

    const names = async (q: string) =>
      (await adminList(`?q=${encodeURIComponent(q)}`)).accounts.map((a: { name: string }) => a.name);
    expect(await names("PLAY")).toEqual(["player"]);
    expect(await names("example.org")).toEqual(["player"]);
    expect(await names("0%_")).toEqual(["Zoë 100%_sure"]);
    // % and _ are themselves, not patterns.
    expect(await names("%")).toEqual(["Zoë 100%_sure"]);
    expect(await names("a_m")).toEqual([]);
    expect(await names("nobody")).toEqual([]);
  });

  it("list 50 to a page", async () => {
    await server.db.query(
      `INSERT INTO accounts (id, name, language, created_at)
       SELECT gen_random_uuid(), 'filler ' || n, 'en', now() - n * interval '1 minute' FROM generate_series(1, 60) n`,
    );
    const first = await adminList();
    expect(first.total).toBe(62);
    expect(first.accounts).toHaveLength(50);
    const second = await adminList("?page=2");
    expect(second.accounts).toHaveLength(12);
    expect(second.page).toBe(2);
    expect((await adminList("?page=3")).accounts).toEqual([]);
    expect((await admin.call("GET", "/api/admin/accounts?page=0")).status).toBe(400);
    expect((await admin.call("GET", "/api/admin/accounts?page=x")).status).toBe(400);
  });

  it("make a player an admin and back", async () => {
    const res = await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "admin" });
    expect(res).toMatchObject({ status: 200, json: { role: "admin" } });
    expect((await other.call("GET", "/api/account")).json.account.role).toBe("admin");
    expect((await other.call("GET", "/api/admin/accounts")).status).toBe(200);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`made admin account ${theirs.id}`)));

    const back = await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "player" });
    expect(back.status).toBe(200);
    expect((await other.call("GET", "/api/admin/accounts")).status).toBe(403);
    expect(
      (await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "boss" })).status,
    ).toBe(400);
    expect(
      (
        await admin.call("PATCH", "/api/admin/accounts/00000000-0000-4000-8000-000000000000/role", {
          role: "admin",
        })
      ).json.error.code,
    ).toBe("accountNotFound");
  });

  it("keep the last admin an admin", async () => {
    const own = (await adminList()).accounts.find((a: { self: boolean }) => a.self).id;
    const res = await admin.call("PATCH", `/api/admin/accounts/${own}/role`, { role: "player" });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("lastAdmin");
    expect(await admins()).toBe(1);
    // With a second admin, the first may step down.
    await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "admin" });
    expect((await admin.call("PATCH", `/api/admin/accounts/${own}/role`, { role: "player" })).status).toBe(
      200,
    );
    expect((await admin.call("GET", "/api/admin/accounts")).status).toBe(403);
  });

  it("log an account out everywhere: every session and every key", async () => {
    const phone = new Client(server, "198.51.100.6");
    const password = (await other.call("POST", "/api/account/passwords", { name: "phone" })).json.password
      .secret;
    await phone.call("POST", "/api/auth/login", { login: "player", password });
    const res = await admin.call("POST", `/api/admin/accounts/${theirs.id}/logout-all`);
    expect(res).toMatchObject({ status: 200, json: { sessions: 2, keys: 1 } });
    expect((await other.call("GET", "/api/account")).status).toBe(401);
    expect((await phone.call("GET", "/api/account")).status).toBe(401);
    const tool = await new Client(server).call("GET", "/api/account", undefined, {
      authorization: `Bearer ${theirs.key}`,
    });
    expect(tool.status).toBe(401);
    // The admin's own login stays; the passwords stay, so the owner logs in again.
    expect((await admin.call("GET", "/api/account")).status).toBe(200);
    expect((await phone.call("POST", "/api/auth/login", { login: "player", password })).status).toBe(200);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`logged out everywhere account ${theirs.id}`));
    expect(
      (await admin.call("POST", "/api/admin/accounts/00000000-0000-4000-8000-000000000000/logout-all"))
        .status,
    ).toBe(404);
  });

  it("delete an account with everything it has", async () => {
    await other.call("POST", "/api/drafts", { packageId: "demo" });
    const res = await admin.call("DELETE", `/api/admin/accounts/${theirs.id}`);
    expect(res.status).toBe(204);
    expect((await other.call("GET", "/api/account")).status).toBe(401);
    const left = await server.db.query("SELECT id FROM drafts");
    expect(left).toEqual([]);
    expect((await adminList()).total).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`deleted account ${theirs.id}`));
    // Nothing of the account in the log line: no name, no address.
    for (const [line] of log.mock.calls) {
      expect(String(line)).not.toMatch(/player@example\.org|player /);
    }
    expect((await admin.call("DELETE", `/api/admin/accounts/${theirs.id}`)).json.error.code).toBe(
      "accountNotFound",
    );
    expect((await admin.call("DELETE", "/api/admin/accounts/not-an-id")).status).toBe(404);
  });

  it("never delete the admin's own account", async () => {
    await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "admin" });
    const own = (await adminList()).accounts.find((a: { self: boolean }) => a.self).id;
    const res = await admin.call("DELETE", `/api/admin/accounts/${own}`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("ownAccount");
    expect(await admins()).toBe(2);
  });

  it("never delete the last admin", async () => {
    // Over HTTP only another admin can ask, so there are two; the store keeps the rule all the same,
    // for two admins deleting each other at once.
    const own = (await adminList()).accounts.find((a: { self: boolean }) => a.self).id;
    expect(await server.app.store.deleteAccountUnlessLastAdmin(own)).toEqual({
      deleted: false,
      reason: "lastAdmin",
    });
    expect(await admins()).toBe(1);
    await admin.call("PATCH", `/api/admin/accounts/${theirs.id}/role`, { role: "admin" });
    const both = await Promise.all([
      server.app.store.deleteAccountUnlessLastAdmin(own),
      server.app.store.deleteAccountUnlessLastAdmin(theirs.id),
    ]);
    expect(both.filter((r) => r.deleted)).toHaveLength(1);
    expect(await admins()).toBe(1);
  });
});

it("no MCP tool reaches an admin route", () => {
  const dir = new URL("../../../../../packages/mcp/src/", import.meta.url).pathname;
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  expect(files.length).toBeGreaterThan(10);
  for (const f of files) {
    expect(readFileSync(join(f.parentPath, f.name), "utf8"), f.name).not.toMatch(/api\/admin/);
  }
});
