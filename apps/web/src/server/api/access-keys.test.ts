/**
 * Access keys: made in the settings, shown once, stored as a hash, valid
 * for the own account only, withdrawn at once. And a whole character built
 * by a tool that has nothing but a key.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { accessKeyHash, readBearerKey } from "../auth/access-keys.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let owner: Client;

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server);
  await signIn(owner, "owner@example.org");
});

async function makeKey(
  client: Client = owner,
  name = "Laptop at home",
): Promise<{ id: string; name: string; hint: string; secret: string }> {
  const res = await client.call("POST", "/api/account/keys", { name });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.key;
}

/** A tool: no cookie, no Origin, only the key. */
function tool(key: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await toolRequest(key, method, path, body);
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
    const json: any =
      text && res.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(text) : null;
    return { status: res.status, json, headers: res.headers };
  };
  return { call, request: (method: string, path: string) => toolRequest(key, method, path) };
}

function toolRequest(key: string, method: string, path: string, body?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${key}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return server.fetch(
    new Request(`http://builder.test${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

interface ChoiceState {
  id: string;
  kind: string;
  status: string;
  optional: boolean;
  options?: string[];
  count?: number;
  min?: number;
  recommended?: unknown;
}

/** What a tool answers: the recommendation where there is one, else the first options. */
function answerFor(c: ChoiceState): unknown {
  switch (c.kind) {
    case "pickOne":
      return { pick: (c.recommended as string[] | undefined)?.[0] ?? c.options![0] };
    case "pickMany": {
      const rec = (c.recommended as string[] | undefined) ?? [];
      return { picks: rec.length === c.count ? rec : c.options!.slice(0, c.count) };
    }
    case "distribute":
      return c.recommended;
    case "number":
      return { value: c.min };
    case "text":
      return { text: "Mira Fennwick" };
  }
  throw new Error(`no answer for ${c.kind}`);
}

describe("making, listing and withdrawing keys", () => {
  it("shows the key once and stores only its hash", async () => {
    const key = await makeKey();
    expect(key.secret).toMatch(/^cbk_[A-Za-z0-9_-]{43}$/);
    expect(key.secret.startsWith(key.hint)).toBe(true);
    expect(key.hint).toHaveLength(10);

    const list = await owner.call("GET", "/api/account/keys");
    expect(list.status).toBe(200);
    expect(list.json.keys).toEqual([
      { id: key.id, name: "Laptop at home", hint: key.hint, createdAt: "2026-10-04T10:00:00.000Z" },
    ]);
    expect(JSON.stringify(list.json)).not.toContain(key.secret);

    const rows = await server.db.query<Record<string, unknown>>("SELECT * FROM access_keys");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["key_hash"]).toBe(accessKeyHash(key.secret));
    expect(JSON.stringify(rows)).not.toContain(key.secret);
  });

  it("carries a name of 1 to 80 characters, trimmed", async () => {
    expect((await makeKey(owner, "  Desktop at home  ")).name).toBe("Desktop at home");
    expect((await makeKey(owner, "ü".repeat(80))).name).toHaveLength(80);
    for (const body of [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(81) },
      { name: "a\nb" },
      { name: 7 },
    ]) {
      const res = await owner.call("POST", "/api/account/keys", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe("badRequest");
    }
    // Nothing a caller sends sets an end or a kind.
    const res = await owner.call("POST", "/api/account/keys", {
      name: "Assistant",
      expiresAt: "2026-10-05T00:00:00.000Z",
      kind: "assistant",
    });
    expect(res.status).toBe(400);
    const rows = await server.db.query("SELECT name, expires_at, kind FROM access_keys ORDER BY name");
    expect(rows).toEqual([
      { name: "Desktop at home", expires_at: null, kind: "personal" },
      { name: "ü".repeat(80), expires_at: null, kind: "personal" },
    ]);
  });

  it("refuses a key past its end like a withdrawn one", async () => {
    const key = await makeKey();
    const t = tool(key.secret);
    expect((await t.call("GET", "/api/account")).status).toBe(200);

    // Not settable over the API yet; a later assistant's keys will carry an end.
    const now = server.app.now();
    const setEnd = (at: Date) =>
      server.db.query("UPDATE access_keys SET expires_at = $2 WHERE id = $1", [key.id, at]);
    await setEnd(new Date(now.getTime() + 60_000));
    expect((await t.call("GET", "/api/account")).status).toBe(200);

    await setEnd(new Date(now.getTime() - 1));
    const res = await t.call("GET", "/api/drafts");
    expect(res.status).toBe(401);
    expect(res.json.error).toEqual({ code: "keyNotValid" });
    // The same at the very moment it ends.
    await setEnd(now);
    expect((await t.call("GET", "/api/account")).json.error).toEqual({ code: "keyNotValid" });
    // The owner still sees it in the list and can withdraw it.
    expect((await owner.call("GET", "/api/account/keys")).json.keys.map((k: { id: string }) => k.id)).toEqual(
      [key.id],
    );
  });

  it("works as `Authorization: Bearer`, and a withdrawn key gets 401 at once", async () => {
    const key = await makeKey();
    const t = tool(key.secret);
    const me = await t.call("GET", "/api/account");
    expect(me.status).toBe(200);
    expect(me.json.account.email).toBe("owner@example.org");
    // A key never gets a session cookie.
    expect(me.headers.get("set-cookie")).toBeNull();

    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    const after = await t.call("GET", "/api/account");
    expect(after.status).toBe(401);
    expect(after.json.error).toEqual({ code: "keyNotValid" });
    expect((await owner.call("GET", "/api/account/keys")).json.keys).toEqual([]);
    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(404);
  });

  it("refuses unknown and malformed keys with keyNotValid, missing ones with notLoggedIn", async () => {
    for (const header of [
      "Bearer cbk_" + "A".repeat(43),
      "Bearer nonsense",
      "Basic dXNlcjpwYXNz",
      "Bearer",
    ]) {
      const res = await server.fetch(
        new Request("http://builder.test/api/drafts", { headers: { authorization: header } }),
      );
      expect(res.status, header).toBe(401);
      expect((await res.json()).error.code).toBe("keyNotValid");
    }
    const none = await server.fetch(new Request("http://builder.test/api/drafts"));
    expect((await none.json()).error.code).toBe("notLoggedIn");
    // Public routes stay public.
    const pub = await server.fetch(
      new Request("http://builder.test/api/packages", { headers: { authorization: "Bearer nonsense" } }),
    );
    expect(pub.status).toBe(200);
  });

  it("reads the Authorization header strictly", () => {
    const key = "cbk_" + "a".repeat(43);
    expect(readBearerKey(null)).toBeUndefined();
    expect(readBearerKey(`Bearer ${key}`)).toBe(key);
    expect(readBearerKey(`bearer ${key}`)).toBe(key);
    expect(readBearerKey(`Bearer ${key}x`)).toBeNull();
    expect(readBearerKey(`Bearer ${key} extra`)).toBeNull();
    expect(readBearerKey(key)).toBeNull();
  });

  it("is judged by the key alone, never by a cookie sent along", async () => {
    const stranger = new Client(server, "198.51.100.9");
    await signIn(stranger, "stranger@example.org");
    const key = await makeKey();
    const res = await stranger.call("GET", "/api/account", undefined, {
      authorization: `Bearer ${key.secret}`,
    });
    expect(res.json.account.email).toBe("owner@example.org");
  });

  it("sees only its own account", async () => {
    const stranger = new Client(server, "198.51.100.9");
    await signIn(stranger, "stranger@example.org");
    const theirs = (await stranger.call("POST", "/api/drafts", { packageId: "demo" })).json.draft.id;
    const theirKey = await makeKey(stranger);

    const key = await makeKey();
    const t = tool(key.secret);
    expect((await t.call("GET", "/api/drafts")).json.drafts).toEqual([]);
    expect((await t.call("GET", `/api/drafts/${theirs}`)).status).toBe(404);
    expect((await t.request("GET", `/api/drafts/${theirs}/pdf`)).status).toBe(404);
    expect((await t.call("DELETE", `/api/drafts/${theirs}`)).status).toBe(404);
    expect((await t.call("DELETE", `/api/account/keys/${theirKey.id}`)).status).toBe(404);
    expect((await t.call("GET", "/api/account/keys")).json.keys.map((k: { id: string }) => k.id)).toEqual([
      key.id,
    ]);
    // Their draft and key are untouched.
    expect((await stranger.call("GET", `/api/drafts/${theirs}`)).status).toBe(200);
    expect((await tool(theirKey.secret).call("GET", "/api/account")).json.account.email).toBe(
      "stranger@example.org",
    );
  });

  it("cannot make keys itself, but can withdraw them", async () => {
    const key = await makeKey();
    const t = tool(key.secret);
    const res = await t.call("POST", "/api/account/keys", { name: "Successor" });
    expect(res.status).toBe(403);
    expect(res.json.error).toEqual({ code: "keyCannotMakeKeys" });
    expect((await t.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    expect((await t.call("GET", "/api/account")).status).toBe(401);
  });

  it("allows at most 20 keys per account", async () => {
    for (let i = 0; i < 20; i++) await makeKey();
    const res = await owner.call("POST", "/api/account/keys", { name: "One more" });
    expect(res.status).toBe(422);
    expect(res.json.error).toEqual({ code: "tooManyKeys", max: 20 });
  });

  it("goes with the account: deleting the account deletes its keys", async () => {
    const key = await makeKey();
    expect((await owner.call("DELETE", "/api/account", { confirm: true })).status).toBe(204);
    expect(await server.db.query("SELECT 1 FROM access_keys")).toEqual([]);
    expect((await tool(key.secret).call("GET", "/api/account")).status).toBe(401);
  });
});

describe("a tool with nothing but a key", () => {
  it("builds a level-3 character of the demo package from empty to PDF", async () => {
    const key = await makeKey();
    const t = tool(key.secret);

    const packages = await t.call("GET", "/api/packages");
    expect(packages.json.packages.map((p: { id: string }) => p.id)).toContain("demo");
    expect((await t.call("GET", "/api/packages/demo/texts/de")).status).toBe(200);

    const created = await t.call("POST", "/api/drafts", { packageId: "demo", level: 3 });
    expect(created.status).toBe(201);
    let view = created.json;
    const id: string = view.draft.id;
    expect(view.draft).toMatchObject({ level: 3, version: 1, status: "draft", answers: {} });

    // Answer the first open choice until nothing is open, exactly as API.md describes.
    const answered: string[] = [];
    while (view.evaluation.open.length > 0) {
      expect(answered.length).toBeLessThan(80);
      const choice: ChoiceState = view.evaluation.choices[view.evaluation.open[0]];
      const res = await t.call("PUT", `/api/drafts/${id}/answers/${encodeURIComponent(choice.id)}`, {
        version: view.draft.version,
        answer: answerFor(choice),
      });
      expect(res.status, `${choice.id}: ${JSON.stringify(res.json)}`).toBe(200);
      answered.push(choice.id);
      view = res.json;
    }
    expect(view.evaluation.complete).toBe(true);
    expect(answered.length).toBeGreaterThan(5);

    const done = await t.call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version });
    expect(done.status).toBe(200);
    expect(done.json.draft).toMatchObject({ status: "finished", level: 3 });
    expect(done.json.summary.name).toBe("Mira Fennwick");

    const pdf = await t.request("GET", `/api/drafts/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    // The owner sees the same character in the browser.
    const list = await owner.call("GET", "/api/drafts");
    expect(list.json.drafts).toMatchObject([{ id, status: "finished", level: 3 }]);
  });
});
