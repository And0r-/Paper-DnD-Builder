/**
 * `server.mjs` without a key: public, over HTTP. Started as a child process
 * against a stand-in builder that knows one key; the tools against the real
 * API are tested in apps/web/src/server/api/mcp.test.ts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLS } from "./tools/index.ts";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const GOOD = "cbk_good";

let builder: Server;
let child: ChildProcess;
let mcpUrl: string;
const seenKeys: string[] = [];

beforeAll(async () => {
  builder = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    seenKeys.push(auth);
    if (req.url === "/api/account" && auth === `Bearer ${GOOD}`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ account: { language: "en", units: "metric" } }));
      return;
    }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "keyNotValid" } }));
  });
  await new Promise<void>((resolve) => builder.listen(0, "127.0.0.1", resolve));
  const builderUrl = `http://127.0.0.1:${(builder.address() as AddressInfo).port}`;

  child = spawn(process.execPath, [MAIN], {
    env: {
      PATH: process.env["PATH"],
      BUILDER_BASE_URL: builderUrl,
      PORT: "0",
      ALLOWED_ORIGINS: "https://builder.example",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  const port = await new Promise<string>((resolve, reject) => {
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const m = /^public, HTTP on port (\d+)\n$/.exec(stderr);
      if (m) resolve(m[1]!);
    });
    child.once("exit", (code) => reject(new Error(`exited ${code}: ${stderr}`)));
  });
  mcpUrl = `http://127.0.0.1:${port}/mcp`;
});

afterAll(() => {
  child?.kill();
  builder?.close();
});

function post(headers: Record<string, string>, url = mcpUrl) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe("server.mjs without a key", () => {
  it("answers 401 without a key and with a key the builder refuses", async () => {
    const none = await post({});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="character-builder"');
    const body = await none.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: null });
    expect(body.error.message).toMatch(/Authorization: Bearer cbk_/);

    const wrong = await post({ authorization: "Bearer cbk_wrong" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(/invalid_token/);
  });

  it("serves the shared tool list with a key the builder accepts, without a session", async () => {
    const res = await post({ authorization: `Bearer ${GOOD}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.has("mcp-session-id")).toBe(false);
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
    // The key went to the builder, as given, and only there.
    expect(seenKeys).toContain(`Bearer ${GOOD}`);
  });

  it("checks the Origin: refused from another site, allowed from the configured one", async () => {
    expect((await post({ authorization: `Bearer ${GOOD}`, origin: "http://evil.example" })).status).toBe(403);
    expect((await post({ authorization: `Bearer ${GOOD}`, origin: "https://builder.example" })).status).toBe(
      200,
    );
  });

  it("is at /mcp only, and takes POST only", async () => {
    expect((await post({ authorization: `Bearer ${GOOD}` }, mcpUrl.replace("/mcp", "/other"))).status).toBe(
      404,
    );
    const get = await fetch(mcpUrl);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("takes no key from the address", async () => {
    expect((await post({}, `${mcpUrl}?key=${GOOD}`)).status).toBe(401);
  });
});
