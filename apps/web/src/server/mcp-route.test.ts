/**
 * The web app's public MCP server `/mcp` and the public zip
 * `/downloads/builder-mcp.zip`: 401 without a key, two accounts kept apart,
 * a browser sent to the page about it, the limit per address, no request
 * leaving the process; the zip without a login, without a key, with no
 * rulebook term in it. The old per-account download is gone.
 */
import { TOOLS } from "@builder/mcp";
import { rulebookHits } from "@builder/mcp/rulebook-terms";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "./auth/rate-limit.ts";
import { createMcpRoute, MCP_SETUP_PATH } from "./mcp-route.ts";
import { buildMcpZip, mcpZipResponse, type McpZip } from "./mcp-zip.ts";
import { Client, signIn, startTestServer, type TestServer } from "./testing.ts";

let server: TestServer;
let owner: Client;
/** Every request that tried to leave the process. */
let outside: string[];

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server);
  await signIn(owner, "owner@example.org", "en");
  outside = [];
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    outside.push(input instanceof Request ? input.url : String(input));
    return Promise.reject(new Error("no request may leave the server"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Nothing went over the network: the tools reach the API in process.
  expect(outside).toEqual([]);
});

const mcp = () => createMcpRoute(server.app, server.fetch);

async function makeKey(client: Client = owner): Promise<{ id: string; secret: string }> {
  const res = await client.call("POST", "/api/account/keys", { name: "Language model" });
  expect(res.status).toBe(201);
  return res.json.key;
}

let rpcId = 0;
function post(route: ReturnType<typeof mcp>, headers: Record<string, string>, body?: unknown) {
  return route(
    new Request("http://builder.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": "198.51.100.4",
        ...headers,
      },
      body: JSON.stringify(body ?? { jsonrpc: "2.0", id: ++rpcId, method: "tools/list" }),
    }),
  );
}

/** One tool call as an MCP program sends it; the tool's answer, parsed. */
async function callTool(route: ReturnType<typeof mcp>, key: string, name: string, args = {}) {
  const res = await post(
    route,
    { authorization: `Bearer ${key}` },
    { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } },
  );
  expect(res.status).toBe(200);
  const { result } = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool data is checked field by field
  return { isError: result.isError === true, data: JSON.parse(result.content[0].text) as any };
}

describe("/mcp", () => {
  it("answers 401 without a key and with a withdrawn one, with the way to a key", async () => {
    const route = mcp();
    const none = await post(route, {});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await none.json()).error.message).toMatch(/http:\/\/builder\.test under Settings, Access keys/);
    expect((await post(route, { authorization: "Bearer cbk_not-a-real-key" })).status).toBe(401);

    const key = await makeKey();
    const ok = await post(route, { authorization: `Bearer ${key.secret}` });
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.tools).toHaveLength(TOOLS.length);

    // Withdrawn: refused with the very next request.
    expect((await owner.call("DELETE", `/api/account/keys/${key.id}`)).status).toBe(204);
    const withdrawn = await post(route, { authorization: `Bearer ${key.secret}` });
    expect(withdrawn.status).toBe(401);
    expect((await withdrawn.json()).error.message).toMatch(/not valid/);
  });

  it("with key A shows only A's characters, never B's", async () => {
    const other = new Client(server, "203.0.113.8");
    await signIn(other, "other@example.org");
    const theirId: string = (await other.call("POST", "/api/drafts", { packageId: "demo" })).json.draft.id;
    const keyA = (await makeKey()).secret;
    const keyB = (await makeKey(other)).secret;
    const route = mcp();

    const mine: string = (await callTool(route, keyA, "start_character", { packageId: "demo", level: 1 }))
      .data.characterId;
    const ids = (r: { data: { characterId: string }[] }) => r.data.map((c) => c.characterId);
    expect(ids(await callTool(route, keyA, "list_characters"))).toEqual([mine]);
    expect(ids(await callTool(route, keyB, "list_characters"))).toEqual([theirId]);

    for (const [name, args] of [
      ["get_character", { characterId: theirId }],
      ["set_level", { characterId: theirId, level: 2 }],
      ["get_sheet", { characterId: theirId }],
    ] as const) {
      const res = await callTool(route, keyA, name, args);
      expect(res.isError, name).toBe(true);
      expect(res.data.message, name).toMatch(/no character with this id/);
    }
    expect((await callTool(route, keyB, "get_character", { characterId: mine })).isError).toBe(true);
    expect((await other.call("GET", `/api/drafts/${theirId}`)).json.draft).toMatchObject({ level: 1 });
  });

  it("sends a browser to the page about it; programs get JSON", async () => {
    const route = mcp();
    const browser = await route(
      new Request("http://builder.test/mcp", {
        headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      }),
    );
    expect(browser.status).toBe(303);
    expect(browser.headers.get("location")).toBe(MCP_SETUP_PATH);

    const program = await route(new Request("http://builder.test/mcp", { headers: { accept: "*/*" } }));
    expect(program.status).toBe(405);
    expect(program.headers.get("content-type")).toBe("application/json");
  });

  it("refuses a browser on another site, checked against BASE_URL", async () => {
    const route = mcp();
    const auth = { authorization: `Bearer ${(await makeKey()).secret}` };
    expect((await post(route, { ...auth, origin: "http://evil.example" })).status).toBe(403);
    expect((await post(route, { ...auth, origin: "http://builder.test" })).status).toBe(200);
  });

  it("refuses a body over 1 MB with 413, also without Content-Length", async () => {
    const route = mcp();
    const auth = { authorization: `Bearer ${(await makeKey()).secret}` };
    const big = new TextEncoder().encode(" ".repeat(1_100_000));
    const chunked = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          // Sent in pieces, as a chunked body arrives; no Content-Length at all.
          for (let at = 0; at < big.length; at += 64 * 1024) c.enqueue(big.subarray(at, at + 64 * 1024));
          c.close();
        },
      });
    const send = (body: BodyInit, headers: Record<string, string> = {}) =>
      route(
        new Request("http://builder.test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.4",
            ...auth,
            ...headers,
          },
          body,
          duplex: "half",
        } as RequestInit),
      );
    const res = await send(chunked());
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toMatch(/too large/);
    // Announced by Content-Length: refused the same.
    expect((await send(big, { "content-length": String(big.length) })).status).toBe(413);
    // A small chunked body still gets through.
    const small = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const ok = await send(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(small);
          c.close();
        },
      }),
      { accept: "application/json, text/event-stream" },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.tools).toHaveLength(TOOLS.length);
  });

  it("limits requests per address, with or without a key", async () => {
    const route = mcp();
    const { max } = LIMITS.mcpRequestsPerIp;
    for (let i = 0; i < max; i++) expect((await post(route, {})).status).toBe(401);
    const limited = await post(route, {});
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address is not affected.
    expect((await post(route, { "x-forwarded-for": "198.51.100.5" })).status).toBe(401);
    server.advance(60_000);
    expect((await post(route, {})).status).toBe(401);
  });
});

describe("/downloads/builder-mcp.zip", () => {
  let zip: McpZip;
  beforeEach(async () => {
    const built = await buildMcpZip("https://builder.example");
    if ("missing" in built) throw new Error(`no zip: ${built.missing}`);
    zip = built;
  });

  it("is a zip for everyone: no login, no key, nothing personal", async () => {
    // Asked like curl does: no cookie, no key.
    const res = mcpZipResponse(new Request("https://builder.example/downloads/builder-mcp.zip"), zip);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="builder-mcp.zip"');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("content-length")).toBe(String(body.byteLength));

    const files = unzipSync(body);
    expect(Object.keys(files).sort()).toEqual([
      "ANLEITUNG.md",
      "README.md",
      "claude_desktop_config.json",
      "config.json",
      "server.mjs",
    ]);
    const texts = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
    expect(JSON.parse(texts["config.json"]!)).toEqual({ baseUrl: "https://builder.example", key: "" });
    expect(texts["server.mjs"]!.length).toBeGreaterThan(10_000);
    for (const [name, text] of Object.entries(texts)) {
      expect(text, name).not.toMatch(/cbk_[A-Za-z0-9_-]{20}/);
      expect(text, name).not.toContain("owner@example.org");
      expect(rulebookHits(text), name).toEqual([]);
    }
    expect(texts["README.md"]).toContain("https://builder.example");
    expect(texts["ANLEITUNG.md"]).toContain("https://builder.example");
  });

  it("answers 304 when the cache holds this very zip", async () => {
    const res = mcpZipResponse(
      new Request("https://builder.example/downloads/builder-mcp.zip", {
        headers: { "if-none-match": zip.etag },
      }),
      zip,
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(zip.etag);
  });

  it("says why when the server has no address or no server.mjs", async () => {
    const req = new Request("https://builder.example/downloads/builder-mcp.zip");
    const noAddress = mcpZipResponse(req, { missing: "baseUrlNotSet" });
    expect(noAddress.status).toBe(503);
    expect((await noAddress.json()).error.code).toBe("baseUrlNotSet");
  });

  it("replaces the per-account download, which is gone", async () => {
    const res = await owner.call("POST", "/api/account/mcp-package", { withKey: true });
    expect(res.status).toBe(404);
    expect((await owner.call("GET", "/api/account/keys")).json.keys).toEqual([]);
  });
});
