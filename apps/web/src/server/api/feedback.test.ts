/**
 * Feedback (AND-354): a player sends it from the browser, with nothing but
 * the page's path and the language; the admin reads it, marks it done,
 * deletes it. Keys send none, players read none.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstAdmin, DEFAULT_ADMIN_PASSWORD } from "../auth/accounts.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let log: ReturnType<typeof vi.spyOn>;
let admin: Client;
let adminKey: string;
let player: Client;
let playerKey: string;

const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  server = await startTestServer();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  await createFirstAdmin(server.app);
  admin = new Client(server, "198.51.100.1");
  await admin.call("POST", "/api/auth/login", { login: "admin", password: DEFAULT_ADMIN_PASSWORD });
  adminKey = (await admin.call("POST", "/api/account/keys", { name: "Admin laptop" })).json.key.secret;
  player = new Client(server, "198.51.100.2");
  await signIn(player, "player@example.org");
  playerKey = (await player.call("POST", "/api/account/keys", { name: "Laptop" })).json.key.secret;
});

afterEach(() => {
  log.mockRestore();
});

const send = (client: Client, body: object, headers?: Record<string, string>) =>
  client.call("POST", "/api/feedback", body, headers);

async function list(query = "") {
  const res = await admin.call("GET", `/api/admin/feedback${query}`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json;
}

describe("sending feedback", () => {
  it("answers 401 without a login", async () => {
    const res = await send(new Client(server), { kind: "other", text: "Hallo" });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("notLoggedIn");
  });

  it("answers 403 to an access key, an admin's too", async () => {
    for (const key of [playerKey, adminKey]) {
      const res = await send(
        new Client(server),
        { kind: "other", text: "Hallo" },
        {
          authorization: `Bearer ${key}`,
        },
      );
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("keyCannotFeedback");
    }
    expect((await list()).total).toBe(0);
  });

  it("stores the text with the kind, the rating, the page and the account's language", async () => {
    await player.call("PATCH", "/api/account/settings", { language: "fr" });
    const res = await send(player, {
      kind: "wrong",
      rating: 4,
      text: "  Der Knopf fehlt.\nZweite Zeile.  ",
      page: "/drafts/abc",
    });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ id: expect.any(String), createdAt: "2026-10-04T10:00:00.000Z" });
    const rows = await server.db.query(
      "SELECT kind, rating, text, page, language, status FROM feedback WHERE id = $1",
      [res.json.id],
    );
    expect(rows).toEqual([
      {
        kind: "wrong",
        rating: 4,
        text: "Der Knopf fehlt.\nZweite Zeile.",
        page: "/drafts/abc",
        language: "fr",
        status: "open",
      },
    ]);
  });

  it("takes rating and page as optional", async () => {
    expect((await send(player, { kind: "idea", text: "Mehr Farben" })).status).toBe(201);
    expect((await send(player, { kind: "idea", text: "Mehr Farben", rating: null, page: null })).status).toBe(
      201,
    );
    const { feedback } = await list();
    expect(feedback[0]).toMatchObject({ rating: null, page: null });
  });

  it("refuses an empty or too long text, a page that is no path, an unknown kind or field", async () => {
    for (const body of [
      { kind: "other", text: "" },
      { kind: "other", text: "   " },
      { kind: "other", text: "x".repeat(2001) },
      { kind: "other", text: "Hallo", page: "https://elsewhere.example/" },
      { kind: "other", text: "Hallo", page: `/${"x".repeat(300)}` },
      { kind: "bug", text: "Hallo" },
      { kind: "other", text: "Hallo", rating: 0 },
      { kind: "other", text: "Hallo", rating: 6 },
      { kind: "other", text: "Hallo", rating: 2.5 },
      { kind: "other", text: "Hallo", userAgent: "x" },
      { text: "Hallo" },
    ]) {
      const res = await send(player, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe("badRequest");
    }
    expect((await send(player, { kind: "other", text: "x".repeat(2000) })).status).toBe(201);
  });

  it("answers 429 after 20 in an hour, per account", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await send(player, { kind: "other", text: `Nr. ${i}` })).status).toBe(201);
    }
    const res = await send(player, { kind: "other", text: "Noch eins" });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("tooManyAttempts");
    expect(res.headers.get("retry-after")).toBeTruthy();
    // Someone else still may.
    expect((await send(admin, { kind: "other", text: "Hallo" })).status).toBe(201);
    server.advance(60 * 60_000 + 1000);
    expect((await send(player, { kind: "other", text: "Später" })).status).toBe(201);
  });

  it("refuses feedback sent from another site", async () => {
    const res = await send(player, { kind: "other", text: "Hallo" }, { origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("crossSite");
  });
});

describe("the admin's feedback", () => {
  let first: string;

  beforeEach(async () => {
    first = (await send(player, { kind: "wrong", rating: 2, text: "Eins", page: "/" })).json.id;
    server.advance(1000);
    await send(player, { kind: "idea", text: "Zwei" });
    server.advance(1000);
    await send(admin, { kind: "other", rating: 5, text: "Drei", page: "/settings" });
  });

  const routes = (id: string) =>
    [
      ["GET", "/api/admin/feedback", undefined],
      ["PATCH", `/api/admin/feedback/${id}/status`, { status: "done" }],
      ["DELETE", `/api/admin/feedback/${id}`, undefined],
    ] as const;

  it("is the admin's only, in the browser", async () => {
    for (const [method, path, body] of routes(first)) {
      const anon = await new Client(server).call(method, path, body);
      expect(anon.status, `${method} ${path}`).toBe(401);
      const res = await player.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error.code).toBe("adminOnly");
      for (const key of [adminKey, playerKey]) {
        const tool = await new Client(server).call(method, path, body, { authorization: `Bearer ${key}` });
        expect(tool.status, `${method} ${path}`).toBe(403);
        expect(tool.json.error.code).toBe("keyCannotAdmin");
      }
    }
    expect((await list()).feedback.map((f: { status: string }) => f.status)).toEqual([
      "open",
      "open",
      "open",
    ]);
  });

  it("lists newest first, with the account's name, and filters by status and kind", async () => {
    const all = await list();
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(all.feedback.map((f: { text: string }) => f.text)).toEqual(["Drei", "Zwei", "Eins"]);
    expect(all.feedback[2]).toEqual({
      id: first,
      createdAt: "2026-10-04T10:00:00.000Z",
      account: { id: expect.any(String), name: "player" },
      kind: "wrong",
      rating: 2,
      text: "Eins",
      page: "/",
      language: "de",
      status: "open",
    });
    expect(all.feedback[0].account.name).toBe("admin");

    await admin.call("PATCH", `/api/admin/feedback/${first}/status`, { status: "done" });
    expect((await list("?status=open")).feedback.map((f: { text: string }) => f.text)).toEqual([
      "Drei",
      "Zwei",
    ]);
    expect(await list("?status=done")).toMatchObject({ total: 1, feedback: [{ id: first, status: "done" }] });
    expect((await list("?kind=idea")).feedback.map((f: { text: string }) => f.text)).toEqual(["Zwei"]);
    expect((await list("?status=done&kind=idea")).total).toBe(0);
    for (const q of ["?status=maybe", "?kind=bug", "?page=0", "?page=x", "?other=1"]) {
      expect((await admin.call("GET", `/api/admin/feedback${q}`)).status, q).toBe(400);
    }
  });

  it("lists 50 to a page", async () => {
    await server.db.query(
      `INSERT INTO feedback (id, kind, text, language, created_at)
       SELECT gen_random_uuid(), 'other', 'filler ' || n, 'en', now() - n * interval '1 minute'
       FROM generate_series(1, 60) n`,
    );
    const page1 = await list();
    expect(page1.total).toBe(63);
    expect(page1.feedback).toHaveLength(50);
    const page2 = await list("?page=2");
    expect(page2.feedback).toHaveLength(13);
    expect((await list("?page=3")).feedback).toEqual([]);
  });

  it("marks feedback done and open again, by id only in the log", async () => {
    const res = await admin.call("PATCH", `/api/admin/feedback/${first}/status`, { status: "done" });
    expect(res).toMatchObject({ status: 200, json: { status: "done" } });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`marked done feedback ${first}\\.$`)));
    const back = await admin.call("PATCH", `/api/admin/feedback/${first}/status`, { status: "open" });
    expect(back.json.status).toBe("open");
    expect((await list("?status=open")).total).toBe(3);
    expect(
      (await admin.call("PATCH", `/api/admin/feedback/${first}/status`, { status: "closed" })).status,
    ).toBe(400);
    for (const id of [MISSING, "not-an-id"]) {
      const missing = await admin.call("PATCH", `/api/admin/feedback/${id}/status`, { status: "done" });
      expect(missing.status).toBe(404);
      expect(missing.json.error.code).toBe("feedbackNotFound");
    }
    for (const [line] of log.mock.calls) expect(String(line)).not.toMatch(/Eins|player/);
  });

  it("deletes feedback", async () => {
    expect((await admin.call("DELETE", `/api/admin/feedback/${first}`)).status).toBe(204);
    expect((await list()).total).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`deleted feedback ${first}`));
    for (const id of [first, MISSING, "not-an-id"]) {
      const res = await admin.call("DELETE", `/api/admin/feedback/${id}`);
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe("feedbackNotFound");
    }
  });

  it("keeps the feedback of a deleted account, without the account", async () => {
    expect((await player.call("DELETE", "/api/account", { confirm: true })).status).toBe(204);
    const { feedback, total } = await list();
    expect(total).toBe(3);
    const eins = feedback.find((f: { id: string }) => f.id === first);
    expect(eins).toMatchObject({ account: null, text: "Eins", language: "de" });
    expect(feedback.find((f: { text: string }) => f.text === "Drei").account.name).toBe("admin");
  });

  it("is counted on the overview: open and all", async () => {
    await admin.call("PATCH", `/api/admin/feedback/${first}/status`, { status: "done" });
    const stats = await admin.call("GET", "/api/admin/stats");
    expect(stats.json.feedback).toEqual({ open: 2, total: 3 });
  });
});

it("no MCP tool sends feedback or reads it", () => {
  const dir = new URL("../../../../../packages/mcp/src/", import.meta.url).pathname;
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  expect(files.length).toBeGreaterThan(10);
  for (const f of files) {
    expect(readFileSync(join(f.parentPath, f.name), "utf8"), f.name).not.toMatch(/api\/(admin\/)?feedback/);
  }
});
