/**
 * openapi.json and the server agree: every route is described, nothing
 * else is, every error code the server can send is listed, and every
 * answer the server gives on a walk over the whole API (from sign-up to
 * the PDF, with the usual refusals on the way) fits its description.
 */
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { sheetModelSchema } from "@builder/sheet";
import { z } from "zod";
import { GET as docs } from "../../../app/api/docs/route.ts";
import { GET as health } from "../../../app/api/health/route.ts";
import { GET as openapi } from "../../../app/api/openapi.json/route.ts";
import { healthReport } from "../health.ts";
import { createMcpRoute } from "../mcp-route.ts";
import { buildMcpZip, mcpZipResponse } from "../mcp-zip.ts";
import { loadPackages } from "../packages/loader.ts";
import { hashPassword } from "../auth/password.ts";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";
import { ROUTES } from "./router.ts";

const WEB = new URL("../../../", import.meta.url).pathname;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the document is walked generically
const spec: any = JSON.parse(readFileSync(join(WEB, "openapi.json"), "utf8"));

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const toSpecPath = (p: string) => p.replace(/:(\w+)/g, "{$1}");

function specOperations(): string[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => (item as object)[m as keyof object]).map((m) => `${m.toUpperCase()} ${path}`),
  );
}

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(spec, "openapi.json");
const pointer = (...parts: string[]) =>
  parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
const compiled = new Map<string, ValidateFunction>();
function validator(ref: string): ValidateFunction {
  let v = compiled.get(ref);
  if (!v) compiled.set(ref, (v = ajv.compile({ $ref: `openapi.json#/${ref}` })));
  return v;
}

/** The response object of an operation for a status, following a `$ref` into components. */
function responseOf(
  method: string,
  path: string,
  status: number,
): { ref: string; response: Record<string, unknown> } | undefined {
  const responses = spec.paths[path][method].responses;
  const key = String(status) in responses ? String(status) : status >= 500 ? "default" : undefined;
  if (!key) return undefined;
  let ref = pointer("paths", path, method, "responses", key);
  let response = responses[key];
  if (response.$ref) {
    ref = (response.$ref as string).slice(2);
    response = ref.split("/").reduce((o, p) => o[p.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
  }
  return { ref, response };
}

interface Seen {
  method: string;
  path: string;
  status: number;
  type: string;
  body: unknown;
  /** The request body, if it was JSON. */
  sent: unknown;
}

describe("openapi.json", () => {
  it("is OpenAPI 3.1 and every $ref in it resolves", () => {
    expect(spec.openapi).toBe("3.1.0");
    const refs = JSON.stringify(spec).match(/"\$ref":"#\/[^"]+"/g) ?? [];
    for (const r of new Set(refs)) {
      const path = r.slice(10, -1).split("/");
      const target = path.reduce<unknown>(
        (o, p) => (o as Record<string, unknown> | undefined)?.[p.replace(/~1/g, "/").replace(/~0/g, "~")],
        spec,
      );
      expect(target, r).toBeDefined();
    }
  });

  it("describes every route of the server and nothing else", () => {
    const server = [
      ...ROUTES.map((r) => `${r.method} ${toSpecPath(r.path)}`),
      "GET /api/health",
      // Outside the router: app/api/docs, app/api/openapi.json, app/mcp, app/downloads/builder-mcp.zip
      // and the live channel's WebSocket (src/server/live).
      "GET /api/live/drafts/{id}",
      "GET /api/docs",
      "GET /api/openapi.json",
      "GET /mcp",
      "POST /mcp",
      "GET /downloads/builder-mcp.zip",
    ];
    expect(specOperations().sort()).toEqual(server.sort());
  });

  it("describes the sheet model exactly as the schema a stored sheet is checked with", () => {
    const { $schema: _, ...schema } = z.toJSONSchema(sheetModelSchema);
    expect(spec.components.schemas.SheetModel).toEqual(schema);
  });

  it("lists every error code the server can send", () => {
    const codes = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|testing\.ts$/.test(entry.name)) {
          const text = readFileSync(file, "utf8");
          for (const m of text.matchAll(/HttpError\(\s*\d+,\s*"(\w+)"/g)) codes.add(m[1]!);
          for (const m of text.matchAll(/json\(\s*\d+,\s*\{\s*error:\s*\{\s*code:\s*"(\w+)"/g))
            codes.add(m[1]!);
        }
      }
    };
    walk(join(WEB, "src/server"));
    expect(codes.size).toBeGreaterThan(20);
    expect([...spec.components.schemas.ErrorCode.enum].sort()).toEqual([...codes].sort());
  });

  describe("answers on a walk over the whole API", () => {
    const seen: Seen[] = [];
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer();
      const record = server.fetch;
      server.fetch = async (req) => {
        const raw = req.headers.get("content-type")?.startsWith("application/json")
          ? await req.clone().text()
          : "";
        let sent: unknown;
        try {
          sent = raw ? JSON.parse(raw) : undefined;
        } catch {
          sent = undefined;
        }
        const res = await record(req);
        const type = res.headers.get("content-type") ?? "";
        const text = await res.clone().text();
        const body: unknown = type.startsWith("application/json") && text ? JSON.parse(text) : null;
        seen.push({
          method: req.method,
          path: new URL(req.url).pathname,
          status: res.status,
          type,
          body,
          sent,
        });
        return res;
      };
      await walk(server);
    }, 60_000);

    it("every request that worked and every answer fit their schemas; every status is documented", () => {
      const ops = Object.entries(spec.paths).flatMap(([path, item]) =>
        METHODS.filter((m) => (item as object)[m as keyof object]).map((m) => ({
          method: m,
          path,
          re: new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`),
        })),
      );
      const problems: string[] = [];
      for (const s of seen) {
        const op = ops.find((o) => o.method === s.method.toLowerCase() && o.re.test(s.path));
        if (!op) {
          // Unknown paths and methods: the plain error form.
          if (!validator("components/schemas/Error")(s.body))
            problems.push(`${s.method} ${s.path}: not an Error`);
          continue;
        }
        const request = spec.paths[op.path][op.method].requestBody;
        if (s.status < 300 && request) {
          const v = validator(
            `${pointer("paths", op.path, op.method, "requestBody")}/content/application~1json/schema`,
          );
          if (!v(s.sent)) problems.push(`${s.method} ${op.path} request: ${ajv.errorsText(v.errors)}`);
        } else if (s.status < 300 && s.sent !== undefined) {
          problems.push(`${s.method} ${op.path}: takes a body, none documented`);
        }
        const found = responseOf(op.method, op.path, s.status);
        if (!found) {
          problems.push(`${s.method} ${op.path} → ${s.status}: status not documented`);
          continue;
        }
        const content = found.response["content"] as Record<string, unknown> | undefined;
        if (!content) {
          if (s.status !== 204)
            problems.push(`${s.method} ${op.path} → ${s.status}: has a body, none documented`);
          continue;
        }
        const type = s.type.split(";")[0]!;
        if (!(type in content)) {
          problems.push(`${s.method} ${op.path} → ${s.status}: ${type} not documented`);
          continue;
        }
        if (type !== "application/json") continue;
        const v = validator(`${found.ref}/content/application~1json/schema`);
        if (!v(s.body)) {
          problems.push(
            `${s.method} ${op.path} → ${s.status}: ${ajv.errorsText(v.errors, { separator: "\n  " })}\n  body: ${JSON.stringify(s.body).slice(0, 300)}`,
          );
        }
      }
      expect(problems).toEqual([]);
    });

    it("the walk reaches every route with a success", () => {
      const ok = new Set<string>();
      for (const s of seen) {
        if (s.status >= 300) continue;
        const r = ROUTES.find((r) => {
          if (r.method !== s.method) return false;
          const re = new RegExp(`^${r.path.replace(/:\w+/g, "[^/]+")}$`);
          return re.test(s.path);
        });
        if (r) ok.add(`${r.method} ${r.path}`);
      }
      expect([...ok].sort()).toEqual(ROUTES.map((r) => `${r.method} ${r.path}`).sort());
    });

    it("the walk sees the documented refusals", () => {
      const codes = new Set(seen.map((s) => (s.body as { error?: { code: string } } | null)?.error?.code));
      for (const code of [
        "badJson",
        "badRequest",
        "notLoggedIn",
        "keyNotValid",
        "wrongLogin",
        "crossSite",
        "keyCannotMakeKeys",
        "keyCannotMakePasswords",
        "passwordNotFound",
        "resetLinkInvalid",
        "lastPassword",
        "notFound",
        "draftNotFound",
        "keyNotFound",
        "packageNotFound",
        "languageNotFound",
        "methodNotAllowed",
        "versionConflict",
        "notFinished",
        "jsonRequired",
        "changeRejected",
        "incomplete",
        "unknownUnit",
        "mailFailed",
        "campaignNotFound",
        "gameMasterOnly",
        "playerNotFound",
        "inviteNotFound",
        "helpLinkNotFound",
        "ownerOnly",
        "copyNotFound",
        "valueNotFound",
      ]) {
        expect(codes, code).toContain(code);
      }
    });
  });

  it("describes the health check", async () => {
    const valid = validator(
      `${pointer("paths", "/api/health", "get", "responses", "200")}/content/application~1json/schema`,
    );
    expect(valid(await (await health()).json())).toBe(true);
    expect(valid(healthReport(await loadPackages(DEMO_PACKAGE_DIR, { info() {}, error() {} })))).toBe(true);
  });

  it("serves itself, and the API reference without anything from elsewhere", async () => {
    const file = await openapi();
    expect(Object.keys(spec.paths["/api/openapi.json"].get.responses["200"].content)).toEqual([
      file.headers.get("content-type"),
    ]);
    expect(await file.json()).toEqual(spec);

    const page = await docs();
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await page.text();
    expect(html).toContain("<title>Character builder HTTP API</title>");
    expect(html).toContain('"url": "/api/openapi.json"');
    expect(html).toContain('"withDefaultFonts": false');
    expect(html).toContain('"telemetry": false');
    expect(html).toContain('"proxyUrl": ""');
    expect(html).toContain("from '/scalar/standalone.esm.js'");
    expect(html).toContain("globalThis.__zod_globalConfig = { jitless: true }");
    // No script, import, stylesheet or font from another address.
    expect(html).not.toMatch(/(src=|href=|import\b[^;]*from\s*|url\()\s*["'(]?\s*(https?:)?\/\//i);
  });

  it("describes the answers of /mcp and of the zip", async () => {
    const server = await startTestServer();
    const route = createMcpRoute(server.app, server.fetch);
    const valid = (path: string, method: string, status: number) =>
      validator(
        `${pointer("paths", path, method, "responses", String(status))}/content/application~1json/schema`,
      );

    const noKey = await route(
      new Request("http://builder.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(noKey.status).toBe(401);
    expect(valid("/mcp", "post", 401)(await noKey.json())).toBe(true);
    const browser = await route(new Request("http://builder.test/mcp", { headers: { accept: "text/html" } }));
    expect(browser.status).toBe(303);
    expect(spec.paths["/mcp"].get.responses["303"]).toBeDefined();
    const program = await route(new Request("http://builder.test/mcp"));
    expect(program.status).toBe(405);
    expect(valid("/mcp", "get", 405)(await program.json())).toBe(true);

    const req = new Request("http://builder.test/downloads/builder-mcp.zip");
    for (const missing of ["baseUrlNotSet", "mcpPackageMissing"] as const) {
      const res = mcpZipResponse(req, { missing });
      expect(res.status).toBe(503);
      expect(valid("/downloads/builder-mcp.zip", "get", 503)(await res.json())).toBe(true);
    }
    const zip = await buildMcpZip("http://builder.test");
    expect("missing" in zip).toBe(false);
    const res = mcpZipResponse(req, zip);
    expect(res.status).toBe(200);
    expect(Object.keys(spec.paths["/downloads/builder-mcp.zip"].get.responses["200"].content)).toEqual([
      res.headers.get("content-type"),
    ]);
  });
});

// ------------------------------------------------------------------ the walk

interface ChoiceState {
  id: string;
  kind: string;
  step: string;
  options?: string[];
  count?: number;
  min?: number;
  recommended?: unknown;
}

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

/** Every route with a success, and the refusals a tool meets. */
async function walk(server: TestServer): Promise<void> {
  const c = new Client(server);
  const call = c.call.bind(c);

  // Login and refusals before it.
  expect((await call("GET", "/api/account")).status).toBe(401);
  await call("POST", "/api/auth/signup", "{nope", { "content-type": "application/json" });
  await call("POST", "/api/auth/signup", { name: "Walker", email: "not a mail" });
  await call("POST", "/api/auth/signup", "x", { "content-type": "text/plain" });
  await call("POST", "/api/auth/login", { login: "Walker", password: "wrong-words-here-and-there-1234" });
  await call("POST", "/api/auth/login", { login: "old@example.org", password: "wrong-words-here-1234" });
  // An account from before, with its one old password: swapped for a new one at its first login.
  await server.db.query(
    `INSERT INTO accounts (id, name, email, password_hash, language, created_at)
     VALUES ('00000000-0000-4000-8000-0000000000aa', 'old', 'old@example.org', $1, 'en', now())`,
    [await hashPassword("anker-falke-wiese-7320")],
  );
  await new Client(server, "198.51.100.40").call("POST", "/api/auth/login", {
    login: "old@example.org",
    password: "anker-falke-wiese-7320",
  });
  await signIn(c, "walker@example.org");
  // A link back in: asked for, used once, refused the second time. Its password is the only one then.
  const lost = new Client(server, "198.51.100.41");
  await lost.call("POST", "/api/auth/reset", { email: "nobody@example.org" });
  server.failMail.on = true;
  await lost.call("POST", "/api/auth/reset", { email: "walker@example.org" });
  server.failMail.on = false;
  await lost.call("POST", "/api/auth/reset", { email: "walker@example.org", language: "de" });
  const token = /\/login\/reset\/([\w-]+)/.exec(server.mails.at(-1)!.text)![1];
  const reset = (await lost.call("POST", "/api/auth/reset/use", { token })).json.password;
  await lost.call("POST", "/api/auth/reset/use", { token });
  await call("POST", "/api/drafts", { packageId: "demo" }, { origin: "https://elsewhere.example" });
  await call("GET", "/api/nothing-here");
  await call("PUT", "/api/account");

  // Account and settings.
  await call("GET", "/api/account");
  await call("PATCH", "/api/account/settings", { language: "en", units: { length: null } });
  await call("PATCH", "/api/account/settings", { units: { length: "parsec" } });
  await call("PATCH", "/api/account/settings", { language: "de", name: "Walker", email: null });
  await call("PATCH", "/api/account/settings", { email: "walker@example.org" });
  await call("PATCH", "/api/account/settings", { print: { parts: ["sheet", "texts"], design: "verbose" } });
  await call("PATCH", "/api/account/settings", { print: { design: "classic" } });
  await call("PATCH", "/api/account/settings", { mailReminder: false });
  await call("GET", "/api/sheet-designs");

  // Own passwords.
  const paper = (await call("POST", "/api/account/passwords", { name: "On paper" })).json.password;
  await call("POST", "/api/account/passwords", { name: "" });
  await call("GET", "/api/account/passwords");
  await call("DELETE", "/api/account/passwords/00000000-0000-4000-8000-000000000000");
  await call("DELETE", `/api/account/passwords/${paper.id}`);
  await call("DELETE", `/api/account/passwords/${reset.id}`);

  // Keys.
  const made = await call("POST", "/api/account/keys", { name: "Laptop at home" });
  await call("POST", "/api/account/keys", { name: "" });
  const key: string = made.json.key.secret;
  await call("GET", "/api/account/keys");
  await call("GET", "/api/account", undefined, { authorization: "Bearer cbk_unknown" });
  await call("POST", "/api/account/keys", { name: "Next" }, { authorization: `Bearer ${key}` });
  await call("POST", "/api/account/passwords", {}, { authorization: `Bearer ${key}` });
  await call("DELETE", "/api/account/keys/00000000-0000-4000-8000-000000000000");
  const second = await call("POST", "/api/account/keys", { name: "Second" });
  await call("DELETE", `/api/account/keys/${second.json.key.id}`);

  // Packages.
  await call("GET", "/api/packages?lang=en");
  await call("GET", "/api/packages/demo");
  await call("GET", "/api/packages/nothing");
  await call("GET", "/api/packages/demo/texts/de");
  await call("GET", "/api/packages/demo/texts/xx");

  // A character, with an access key from here on.
  const k = { authorization: `Bearer ${key}` };
  await call("POST", "/api/drafts", { packageId: "nothing" }, k);
  await call("POST", "/api/drafts", { packageId: "demo", level: 999 }, k);
  // Without `extensions`, all of the package's extensions are on; an empty list, none.
  const none = (await call("POST", "/api/drafts", { packageId: "demo", extensions: [] }, k)).json;
  expect(none.draft.extensions).toEqual([]);
  let view = (await call("POST", "/api/drafts", { packageId: "demo", level: 2 }, k)).json;
  expect(view.draft.extensions).toEqual(["demo-tides"]);
  const id: string = view.draft.id;
  await call("GET", `/api/drafts/${id}`, undefined, k);
  await call("GET", "/api/drafts/00000000-0000-4000-8000-000000000000", undefined, k);
  view = (await call("PATCH", `/api/drafts/${id}`, { version: view.draft.version, level: 3 }, k)).json;
  await call("PATCH", `/api/drafts/${id}`, { version: 1, level: 3 }, k);
  await call(
    "PUT",
    `/api/drafts/${id}/answers/nothing`,
    { version: view.draft.version, answer: { pick: "x" } },
    k,
  );
  // Level 2 to the herbalist, then every level back in the first calling; a knack carries no levels.
  const tracks = async (list: string[]) =>
    call("PUT", `/api/drafts/${id}/tracks`, { version: view.draft.version, tracks: list }, k);
  view = (await tracks(["calling.herbalist"])).json;
  await tracks(["knack.eddy"]);
  view = (await tracks([])).json;
  await call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version }, k);
  await call("POST", `/api/drafts/${id}/level-up`, { version: view.draft.version, level: 4 }, k);
  await call("GET", `/api/drafts/${id}/pdf`, undefined, k);
  await call("GET", `/api/drafts/${id}/sheet`, undefined, k);
  await call("GET", `/api/drafts/${id}/explain/might`, undefined, k);
  await call("GET", `/api/drafts/${id}/explain/nothing`, undefined, k);

  for (let guard = 0; view.evaluation.open.length > 0; guard++) {
    if (guard > 80) throw new Error("walk does not end");
    const choice: ChoiceState = view.evaluation.choices[view.evaluation.open[0]];
    const step = view.evaluation.steps.find((s: { id: string }) => s.id === choice.step);
    const res = step.pool
      ? await call(
          "PUT",
          `/api/drafts/${id}/pools/${step.id}`,
          { version: view.draft.version, picks: step.pool.recommended },
          k,
        )
      : await call(
          "PUT",
          `/api/drafts/${id}/answers/${encodeURIComponent(choice.id)}`,
          { version: view.draft.version, answer: answerFor(choice) },
          k,
        );
    if (res.status !== 200) throw new Error(`${choice.id}: ${res.status} ${JSON.stringify(res.json)}`);
    view = res.json;
  }
  view = (await call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version }, k)).json;
  await c.request("GET", `/api/drafts/${id}/pdf`, undefined, k);
  await c.request(
    "GET",
    `/api/drafts/${id}/pdf?parts=sheet,texts&design=verbose&version=original&state=empty`,
    undefined,
    k,
  );
  await call("GET", `/api/drafts/${id}/pdf?parts=poster`, undefined, k);
  await c.request("GET", `/api/drafts/${id}/pdf?parts=sheet&design=classic`, undefined, k);
  await c.request("GET", `/api/drafts/${id}/pdf?parts=sheet&state=filled`, undefined, k);
  await call("GET", `/api/drafts/${id}/pdf?version=elsewhere`, undefined, k);
  const sheet = (await call("GET", `/api/drafts/${id}/sheet`, undefined, k)).json;

  // Kept copies of the sheet and the play state.
  const copies = `/api/drafts/${id}/sheet-copies`;
  const kept = (await call("POST", copies, {}, k)).json;
  await call("POST", copies, { name: "Mit Hausregeln", model: { ...sheet, name: "Mira" } }, k);
  await call("GET", copies, undefined, k);
  const copy = `${copies}/${kept.copy.id}`;
  await c.request(
    "GET",
    `/api/drafts/${id}/pdf?parts=sheet,cards&version=${kept.copy.id}&state=filled`,
    undefined,
    k,
  );
  await call("GET", copy, undefined, k);
  await call("PUT", copy, { version: 1, name: "Neu", model: kept.model }, k);
  await call("PUT", copy, { version: 1, name: "Alt" }, k);
  await call("GET", `${copies}/00000000-0000-4000-8000-000000000000`, undefined, k);
  await call("PUT", `/api/drafts/${id}/sheet-view`, { copyId: kept.copy.id }, k);
  await call("PUT", `/api/drafts/${id}/sheet-view`, { copyId: null }, k);
  await call("PUT", `/api/drafts/${id}/sheet-view`, { copyId: "00000000-0000-4000-8000-000000000000" }, k);
  await call("PUT", `/api/drafts/${id}/sheet-view`, {}, k);
  await call("POST", `/api/drafts/${id}/sheet-places`, { model: kept.model, design: "verbose" }, k);
  await call("POST", `/api/drafts/${id}/sheet-places`, { model: kept.model, design: "none" }, k);
  await call("DELETE", copy, undefined, k);
  await call("GET", `/api/drafts/${id}/state`, undefined, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 0, state: { a: 3, b: "x", c: { checks: 2 } } }, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 0, state: {} }, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 1, clearChecks: true }, k);

  await call("GET", "/api/drafts", undefined, k);
  view = (await call("POST", `/api/drafts/${id}/level-up`, { version: view.draft.version, level: 4 }, k))
    .json;
  await call("PUT", `/api/drafts/${id}/campaign`, { campaignId: null }, k);
  await call("PUT", `/api/drafts/${id}/campaign`, { campaignId: "00000000-0000-4000-8000-000000000000" }, k);
  // Its own package again changes nothing; one that is not loaded is refused.
  await call("PUT", `/api/drafts/${id}/package`, { version: view.draft.version, packageId: "demo" }, k);
  await call("PUT", `/api/drafts/${id}/package`, { version: view.draft.version, packageId: "nothing" }, k);
  await call("DELETE", `/api/drafts/${id}`, undefined, k);

  // A campaign, led by the walker, with a player who has a character.
  const campaign = (await call("POST", "/api/campaigns", { name: "Runde" })).json.campaign;
  const cp = `/api/campaigns/${campaign.id}`;
  await call("POST", "/api/campaigns", { name: "" });
  await call("GET", "/api/campaigns");
  await call("PATCH", cp, { name: "Die Runde" });
  await call("GET", "/api/campaigns/00000000-0000-4000-8000-000000000000");
  const mate = new Client(server, "198.51.100.20");
  await signIn(mate, "mate@example.org", "en");
  const invite = (campaign.inviteUrl as string).split("/join/")[1]!;
  await new Client(server, "198.51.100.21").call("GET", `/api/invites/${invite}`);
  await new Client(server, "198.51.100.21").call("POST", `/api/invites/${invite}/join`);
  await mate.call("GET", "/api/invites/AAAAAAAAAAAAAAAAAAAAAA");
  await mate.call("POST", `/api/invites/${invite}/join`);
  await mate.call("GET", `/api/invites/${invite}`);
  await mate.call("POST", `/api/invites/${invite}/join`);
  await mate.call("POST", `${cp}/invite`);
  const fresh = (await call("POST", `${cp}/invite`)).json.inviteUrl as string;
  await mate.call("POST", `/api/invites/${invite}/join`);
  await call("POST", `/api/invites/${fresh.split("/join/")[1]!}/join`);
  const added = (await call("GET", cp)).json.players[0];
  const theirs = (await mate.call("POST", "/api/drafts", { packageId: "demo", campaignId: campaign.id })).json
    .draft.id;
  await mate.call("GET", "/api/campaigns");
  await mate.call("GET", cp);
  await mate.call("PATCH", cp, { name: "Meine" });
  await call("GET", cp);
  await call("GET", `/api/drafts/${theirs}`, undefined, k);
  // The player asks someone else for help with a help link; the game master needs none.
  const dp = `/api/drafts/${theirs}/help-link`;
  await call("POST", dp);
  await mate.call("GET", dp);
  const help = (await mate.call("POST", dp)).json.helpLink.token as string;
  await mate.call("GET", dp);
  const helper = new Client(server, "198.51.100.22");
  await signIn(helper, "helper@example.org");
  await helper.call("GET", `/api/help/${help}`);
  await helper.call("GET", "/api/help/AAAAAAAAAAAAAAAAAAAAAA");
  await helper.call("GET", `/api/drafts/${theirs}?help=${help}`);
  await helper.call("PUT", `/api/drafts/${theirs}/answers/folk?help=${help}`, {
    version: 1,
    answer: { pick: "folk.hillfolk" },
  });
  await mate.call("DELETE", dp);
  await helper.call("GET", `/api/drafts/${theirs}?help=${help}`);
  await call("DELETE", `/api/drafts/${theirs}`, undefined, k);
  await call("PUT", `/api/drafts/${theirs}/campaign`, { campaignId: null }, k);
  await call("POST", "/api/drafts", { packageId: "demo", campaignId: campaign.id }, k);
  await call("POST", `${cp}/players/${added.id}/drafts`, { packageId: "demo", level: 2 }, k);
  await call("POST", `${cp}/players/00000000-0000-4000-8000-000000000000/drafts`, { packageId: "demo" });
  await call("DELETE", `${cp}/players/00000000-0000-4000-8000-000000000000`);
  await mate.call("DELETE", `${cp}/players/me`);
  await call("DELETE", cp);

  await call("POST", "/api/auth/logout");
  await call("POST", "/api/auth/login", { login: "walker", password: reset.secret });
  await call("DELETE", "/api/account", { confirm: true });
}
