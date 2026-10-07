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
import { GET as health } from "../../../app/api/health/route.ts";
import { healthReport } from "../health.ts";
import { loadPackages } from "../packages/loader.ts";
import { Client, passwordFromMail, signIn, startTestServer, type TestServer } from "../testing.ts";
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
    const server = [...ROUTES.map((r) => `${r.method} ${toSpecPath(r.path)}`), "GET /api/health"];
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
        "wrongMailOrPassword",
        "crossSite",
        "keyCannotMakeKeys",
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
        "alreadyPlayer",
        "cannotAddYourself",
        "ownerOnly",
        "copyNotFound",
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
  await call("POST", "/api/auth/password", "{nope", { "content-type": "application/json" });
  await call("POST", "/api/auth/password", { email: "not a mail" });
  await call("POST", "/api/auth/password", "x", { "content-type": "text/plain" });
  server.failMail.on = true;
  await call("POST", "/api/auth/password", { email: "walker@example.org" });
  server.failMail.on = false;
  await call("POST", "/api/auth/login", {
    email: "walker@example.org",
    password: "wrong-words-here-and-1234",
  });
  await signIn(c, server, "walker@example.org");
  await call("POST", "/api/drafts", { packageId: "demo" }, { origin: "https://elsewhere.example" });
  await call("GET", "/api/nothing-here");
  await call("PUT", "/api/account");

  // Account and settings.
  await call("GET", "/api/account");
  await call("PATCH", "/api/account/settings", { language: "en", units: { length: null } });
  await call("PATCH", "/api/account/settings", { units: { length: "parsec" } });
  await call("PATCH", "/api/account/settings", { language: "de" });
  await call("PATCH", "/api/account/settings", { print: { parts: ["sheet", "texts"], design: "verbose" } });
  await call("PATCH", "/api/account/settings", { print: { design: "classic" } });
  await call("GET", "/api/sheet-designs");
  await call("POST", "/api/account/password");

  // Keys.
  const made = await call("POST", "/api/account/keys", {});
  const key: string = made.json.key.secret;
  await call("GET", "/api/account/keys");
  await call("GET", "/api/account", undefined, { authorization: "Bearer cbk_unknown" });
  await call("POST", "/api/account/keys", {}, { authorization: `Bearer ${key}` });
  await call("DELETE", "/api/account/keys/00000000-0000-4000-8000-000000000000");
  const second = await call("POST", "/api/account/keys", {});
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
  let view = (await call("POST", "/api/drafts", { packageId: "demo", level: 2 }, k)).json;
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
  await call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version }, k);
  await call("POST", `/api/drafts/${id}/level-up`, { version: view.draft.version, level: 4 }, k);
  await call("GET", `/api/drafts/${id}/pdf`, undefined, k);
  await call("GET", `/api/drafts/${id}/sheet`, undefined, k);

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
  await call("GET", `/api/drafts/${id}/pdf?design=classic`, undefined, k);
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
  await call("DELETE", copy, undefined, k);
  await call("GET", `/api/drafts/${id}/state`, undefined, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 0, state: { a: 3, b: "x", c: { checks: 2 } } }, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 0, state: {} }, k);
  await call("PUT", `/api/drafts/${id}/state`, { version: 1, clearChecks: true }, k);

  await call("GET", "/api/drafts", undefined, k);
  view = (await call("POST", `/api/drafts/${id}/level-up`, { version: view.draft.version, level: 4 }, k))
    .json;
  await call("DELETE", `/api/drafts/${id}`, undefined, k);

  // A campaign, led by the walker, with a player who has a character.
  const campaign = (await call("POST", "/api/campaigns", { name: "Runde" })).json.campaign;
  const cp = `/api/campaigns/${campaign.id}`;
  await call("POST", "/api/campaigns", { name: "" });
  await call("GET", "/api/campaigns");
  await call("PATCH", cp, { name: "Die Runde" });
  await call("GET", "/api/campaigns/00000000-0000-4000-8000-000000000000");
  await call("POST", `${cp}/players`, { email: "walker@example.org" });
  server.failMail.on = true;
  await call("POST", `${cp}/players`, { email: "late@example.org" });
  server.failMail.on = false;
  const added = (await call("POST", `${cp}/players`, { email: "mate@example.org", language: "en" })).json
    .player;
  await call("POST", `${cp}/players`, { email: "mate@example.org" });
  const mate = new Client(server, "198.51.100.20");
  await mate.call("POST", "/api/auth/login", {
    email: "mate@example.org",
    password: passwordFromMail(server.mails, "mate@example.org"),
  });
  const theirs = (await mate.call("POST", "/api/drafts", { packageId: "demo" })).json.draft.id;
  await mate.call("GET", "/api/campaigns");
  await mate.call("GET", cp);
  await mate.call("PATCH", cp, { name: "Meine" });
  await call("GET", cp);
  await call("GET", `/api/drafts/${theirs}`, undefined, k);
  await call("DELETE", `/api/drafts/${theirs}`, undefined, k);
  await call("POST", `${cp}/players/${added.id}/drafts`, { packageId: "demo", level: 2 }, k);
  await call("POST", `${cp}/players/00000000-0000-4000-8000-000000000000/drafts`, { packageId: "demo" });
  await call("DELETE", `${cp}/players/00000000-0000-4000-8000-000000000000`);
  await mate.call("DELETE", `${cp}/players/me`);
  await call("DELETE", cp);

  await call("POST", "/api/auth/logout");
  // The password renewed above is the newest in the mailbox.
  const password = passwordFromMail(server.mails, "walker@example.org");
  await call("POST", "/api/auth/login", { email: "walker@example.org", password });
  await call("DELETE", "/api/account", { confirm: true });
}
