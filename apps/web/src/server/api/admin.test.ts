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

describe("the overview", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const C = "00000000-0000-4000-8000-00000000000c";
  const D = "00000000-0000-4000-8000-00000000000d";

  beforeEach(async () => {
    // The clock stands at Sunday 2026-10-04 10:00 UTC: this week began on Monday 2026-09-28.
    await server.db.query(
      `INSERT INTO accounts (id, name, email, language, created_at) VALUES
         ($1, 'A', 'a@example.org', 'de', '2026-10-04T08:00:00Z'),
         ($2, 'B', NULL, 'en', '2026-09-30T12:00:00Z'),
         ($3, 'C', 'c@example.org', 'fr', '2026-04-29T09:00:00Z'),
         ($4, 'D', NULL, 'it', '2025-01-01T09:00:00Z')`,
      [A, B, C, D],
    );
    await server.db.query(
      `INSERT INTO drafts (id, account_id, package_id, package_version, version, document, finished_at, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, 'demo', '1', 1, '{}', '2026-10-03T12:00:00Z', '2026-10-03T11:00:00Z', now()),
         (gen_random_uuid(), $1, 'other', '1', 1, '{}', NULL, '2026-09-20T23:59:00Z', now()),
         (gen_random_uuid(), $2, 'demo', '1', 1, '{}', NULL, '2026-05-01T08:00:00Z', now())`,
      [A, C],
    );
    await server.db.query(
      `INSERT INTO campaigns (id, account_id, name, created_at) VALUES
         ('00000000-0000-4000-8000-0000000000c1', $1, 'Eins', now()),
         ('00000000-0000-4000-8000-0000000000c2', $1, 'Zwei', now())`,
      [A],
    );
    await server.db.query(
      `INSERT INTO campaign_players (campaign_id, account_id, added_at) VALUES
         ('00000000-0000-4000-8000-0000000000c1', $1, now()),
         ('00000000-0000-4000-8000-0000000000c2', $1, now()),
         ('00000000-0000-4000-8000-0000000000c1', $2, now())`,
      [B, C],
    );
    admin = new Client(server, "198.51.100.1");
    await firstAdmin(admin);
    await admin.call("POST", "/api/account/keys", { name: "Laptop" });
  });

  it("counts accounts, characters, campaigns and keys, and the weeks with nothing as 0", async () => {
    const res = await admin.call("GET", "/api/admin/stats");
    expect(res.status).toBe(200);
    const s = res.json;
    expect(s.accounts).toEqual({
      // A, B, C, D and the admin, made at 10:00 today.
      total: 5,
      withEmail: 2,
      withoutEmail: 3,
      newToday: 2,
      new7Days: 3,
      new30Days: 3,
      withoutCharacters: 3,
      byLanguage: [
        { language: "de", count: 2 },
        { language: "en", count: 1 },
        { language: "fr", count: 1 },
        { language: "it", count: 1 },
      ],
    });
    expect(s.characters).toEqual({
      total: 3,
      finished: 1,
      new7Days: 1,
      new30Days: 2,
      byPackage: [
        { packageId: "demo", count: 2 },
        { packageId: "other", count: 1 },
      ],
    });
    expect(s.campaigns).toEqual({ total: 2, players: 2 });
    expect(s.accessKeys).toBe(1);
    // The admin's own session, just now; nobody on a character.
    expect(s.activeNow).toBe(1);
    expect(s.buildingNow).toBe(0);

    const weeks = (list: { week: string; count: number }[]) =>
      Object.fromEntries(list.filter((w) => w.count > 0).map((w) => [w.week, w.count]));
    for (const list of [s.accountsPerWeek, s.draftsPerWeek]) {
      expect(list).toHaveLength(26);
      expect(list[0].week).toBe("2026-04-06");
      expect(list.at(-1).week).toBe("2026-09-28");
      // Every Monday in between, one after the other.
      for (let i = 1; i < list.length; i++) {
        expect(Date.parse(list[i].week) - Date.parse(list[i - 1].week)).toBe(7 * 86_400_000);
      }
    }
    expect(weeks(s.accountsPerWeek)).toEqual({ "2026-04-27": 1, "2026-09-28": 3 });
    expect(s.accountsPerWeek.filter((w: { count: number }) => w.count === 0)).toHaveLength(24);
    // Sunday 23:59 belongs to the week that began on the Monday before.
    expect(weeks(s.draftsPerWeek)).toEqual({ "2026-04-27": 1, "2026-09-14": 1, "2026-09-28": 1 });

    expect(s.server).toEqual({
      packages: [
        expect.objectContaining({ id: "demo", kind: "base" }),
        expect.objectContaining({ kind: "extension", extends: "demo" }),
      ],
      databaseBytes: null,
      startedAt: "2026-10-04T10:00:00.000Z",
    });
  });

  it("counts the browser sessions with a request in the last 10 minutes", async () => {
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "player@example.org");
    // Signing up is no request with the session yet; the next one is.
    expect((await admin.call("GET", "/api/admin/stats")).json.activeNow).toBe(1);
    await other.call("GET", "/api/account");
    expect((await admin.call("GET", "/api/admin/stats")).json.activeNow).toBe(2);
    // Times are kept to 5 minutes: 15 minutes later the player's request is surely past.
    server.advance(15 * 60_000);
    expect((await admin.call("GET", "/api/admin/stats")).json.activeNow).toBe(1);
  });

  it("are the admin's only", async () => {
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "player@example.org");
    expect((await other.call("GET", "/api/admin/stats")).json.error.code).toBe("adminOnly");
    const key = (await admin.call("POST", "/api/account/keys", { name: "Tool" })).json.key.secret;
    const tool = await new Client(server).call("GET", "/api/admin/stats", undefined, {
      authorization: `Bearer ${key}`,
    });
    expect(tool.status).toBe(403);
    expect(tool.json.error.code).toBe("keyCannotAdmin");
    expect((await new Client(server).call("GET", "/api/admin/stats")).status).toBe(401);
  });
});
