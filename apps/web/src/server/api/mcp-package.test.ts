/**
 * The MCP download: a zip with the server, its config, a Claude Desktop
 * entry and the guide in the account's language; a new key only with the
 * session cookie, and that key opens the account's own characters.
 */
import { renderGuide } from "@builder/mcp/download";
import { rulebookHits } from "@builder/mcp/rulebook-terms";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { mcpDir } from "../mcp-package.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let owner: Client;

beforeEach(async () => {
  server = await startTestServer();
  owner = new Client(server);
  await signIn(owner, server, "owner@example.org", "en");
});

async function download(client: Client, withKey: boolean) {
  const res = await client.request("POST", "/api/account/mcp-package", { withKey });
  const body = new Uint8Array(await res.arrayBuffer());
  return { res, body };
}

function unzip(body: Uint8Array): Record<string, string> {
  const files = unzipSync(body);
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

async function keyCount(client: Client = owner): Promise<number> {
  const res = await client.call("GET", "/api/account/keys");
  return res.json.keys.length;
}

/** A tool: no cookie, only the key. */
function withBearer(key: string, method: string, path: string, body?: unknown) {
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

describe("POST /api/account/mcp-package", () => {
  it("zips server, config, Claude Desktop entry and guide with a new, working key", async () => {
    const { res, body } = await download(owner, true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="builder-mcp.zip"');
    expect(res.headers.get("cache-control")).toBe("no-store");

    const files = unzip(body);
    expect(Object.keys(files).sort()).toEqual([
      "README.md",
      "claude_desktop_config.json",
      "config.json",
      "server.mjs",
    ]);
    expect(files["server.mjs"]).toBe(readFileSync(`${mcpDir()}/dist/server.mjs`, "utf8"));

    const secret = res.headers.get("x-builder-key")!;
    const id = res.headers.get("x-builder-key-id")!;
    expect(secret).toMatch(/^cbk_/);
    expect(JSON.parse(files["config.json"]!)).toEqual({ baseUrl: "http://builder.test", key: secret });
    expect(JSON.parse(files["claude_desktop_config.json"]!)).toEqual({
      mcpServers: { "character-builder": { command: "node", args: ["PATH/server.mjs"] } },
    });

    // The key in the list, named for the day, holding no secret; the zip's key opens the drafts.
    const keys = (await owner.call("GET", "/api/account/keys")).json.keys;
    expect(keys).toEqual([expect.objectContaining({ id, name: "MCP package, 2026-10-04" })]);
    expect(JSON.stringify(keys)).not.toContain(secret);
    const drafts = await withBearer(secret, "GET", "/api/drafts");
    expect(drafts.status).toBe(200);

    // English guide, address and key name filled in, no placeholder left.
    const guide = files["README.md"]!;
    expect(guide).toMatch(/^# Character builder with a language model/);
    expect(guide).toContain("your account on **http://builder.test**");
    expect(guide).toContain('Withdraw the key **"MCP package, 2026-10-04"**.');
    expect(guide).not.toContain("{{");
    expect(guide).not.toContain("holds no access key");
  });

  it("without a key: an empty key, the hint where it goes, and no key made", async () => {
    const { res, body } = await download(owner, false);
    expect(res.status).toBe(200);
    expect(res.headers.has("x-builder-key")).toBe(false);
    expect(res.headers.has("x-builder-key-id")).toBe(false);
    const files = unzip(body);
    expect(JSON.parse(files["config.json"]!)).toEqual({ baseUrl: "http://builder.test", key: "" });
    expect(files["README.md"]).toContain("It holds\nno access key yet.");
    expect(files["README.md"]).toContain('`"key": "cbk_..."`');
    expect(files["README.md"]).not.toContain("{{");
    expect(await keyCount()).toBe(0);
  });

  it("writes the guide and the key name in the account's language", async () => {
    await owner.call("PATCH", "/api/account/settings", { language: "de" });
    const { res, body } = await download(owner, true);
    expect(res.status).toBe(200);
    const files = unzip(body);
    expect(files["README.md"]).toMatch(/^# Charakterbuilder mit einem Sprachmodell/);
    expect(files["README.md"]).toContain("**„MCP-Paket, 4.10.2026“**");
    expect(JSON.parse(files["claude_desktop_config.json"]!)).toEqual({
      mcpServers: { charakterbuilder: { command: "node", args: ["PFAD/server.mjs"] } },
    });
    const keys = (await owner.call("GET", "/api/account/keys")).json.keys;
    expect(keys.map((k: { name: string }) => k.name)).toEqual(["MCP-Paket, 4.10.2026"]);
  });

  it("with a key instead of a session: the zip without a key, never a new one", async () => {
    const made = await owner.call("POST", "/api/account/keys", { name: "Laptop" });
    const secret: string = made.json.key.secret;

    const refused = await withBearer(secret, "POST", "/api/account/mcp-package", { withKey: true });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: "keyCannotMakeKeys" } });
    expect(await keyCount()).toBe(1);

    const plain = await withBearer(secret, "POST", "/api/account/mcp-package", { withKey: false });
    expect(plain.status).toBe(200);
    expect(plain.headers.has("x-builder-key")).toBe(false);
    const files = unzip(new Uint8Array(await plain.arrayBuffer()));
    expect(JSON.parse(files["config.json"]!).key).toBe("");
    expect(await keyCount()).toBe(1);
  });

  it("counts the new key towards the limit of 20", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await owner.call("POST", "/api/account/keys", { name: `Key ${i}` })).status).toBe(201);
    }
    const res = await owner.call("POST", "/api/account/mcp-package", { withKey: true });
    expect(res.status).toBe(422);
    expect(res.json).toEqual({ error: { code: "tooManyKeys", max: 20 } });
    // Without a key the zip still comes.
    expect((await download(owner, false)).res.status).toBe(200);
  });

  it("takes the address from the configuration, not from the Host header", async () => {
    const made = await owner.call("POST", "/api/account/keys", { name: "Laptop" });
    const res = await server.fetch(
      new Request("http://elsewhere.example/api/account/mcp-package", {
        method: "POST",
        headers: { authorization: `Bearer ${made.json.key.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ withKey: false }),
      }),
    );
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(files["config.json"]!).baseUrl).toBe("http://builder.test");
    expect(files["README.md"]).not.toContain("elsewhere");
  });

  it("needs a login and a well-formed body", async () => {
    const anon = new Client(server);
    expect((await anon.call("POST", "/api/account/mcp-package", { withKey: false })).status).toBe(401);
    expect((await owner.call("POST", "/api/account/mcp-package", {})).status).toBe(400);
    expect((await owner.call("POST", "/api/account/mcp-package", { withKey: "yes" })).status).toBe(400);
    expect(await keyCount()).toBe(0);
  });

  it("holds no rulebook term in any file it makes", async () => {
    for (const language of ["en", "de"]) {
      await owner.call("PATCH", "/api/account/settings", { language });
      for (const withKey of [true, false]) {
        const files = unzip((await download(owner, withKey)).body);
        const hits = Object.entries(files).flatMap(([name, text]) =>
          rulebookHits(text).map((hit) => `${language}/${name}: ${hit}`),
        );
        expect(hits).toEqual([]);
      }
    }
  });
});

describe("renderGuide", () => {
  it("drops block sections whole and keeps inline ones on their line", () => {
    const template =
      "A\n{{#KEY}}\nwith {{KEY_NAME}}\n{{/KEY}}\n{{^KEY}}\nwithout\n{{/KEY}}\nB {{#KEY}}k{{/KEY}}{{^KEY}}n{{/KEY}}.\n";
    expect(renderGuide(template, { language: "en", baseUrl: "x", key: { secret: "s", name: "N" } })).toBe(
      "A\nwith N\nB k.\n",
    );
    expect(renderGuide(template, { language: "en", baseUrl: "x" })).toBe("A\nwithout\nB n.\n");
  });
});
