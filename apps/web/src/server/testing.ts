/**
 * Test support: the whole server app on an in-process PostgreSQL (PGlite)
 * with the demo package, a mailbox instead of SMTP and a clock the test
 * controls. Only imported by tests.
 */
import { loadMigrations, migrate, type SqlExecutor } from "@builder/db";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { PGlite } from "@electric-sql/pglite";
import { createApiHandler } from "./api/router.ts";
import { createApp, type App } from "./app.ts";
import { migrationsDir, pgliteExecutor } from "./local-backends.ts";
import type { Mail, Mailer } from "./mail.ts";
import { loadPackages } from "./packages/loader.ts";

export const quietLog = { info: () => {}, error: () => {} };

export interface TestServer {
  app: App;
  db: SqlExecutor;
  mails: Mail[];
  /** Makes sending fail until set back to false. */
  failMail: { on: boolean };
  /** Moves the clock forward. */
  advance(ms: number): void;
  fetch(req: Request): Promise<Response>;
}

// One database per test file (starting PGlite is the slow part); emptied for every test.
let shared: Promise<SqlExecutor> | undefined;
async function database(): Promise<SqlExecutor> {
  shared ??= (async () => {
    const db = pgliteExecutor(new PGlite());
    await migrate(db, await loadMigrations(migrationsDir()));
    return db;
  })();
  const db = await shared;
  await db.exec("TRUNCATE accounts CASCADE");
  return db;
}

/**
 * A fresh app (empty database, empty mailbox, fresh limits, own clock) for
 * one test. `packagesDir`: where the packages come from; the demo package
 * (with its extension) by default. Apps share one database: a second one
 * empties it again.
 */
export async function startTestServer(options: { packagesDir?: string } = {}): Promise<TestServer> {
  const db = await database();
  const mails: Mail[] = [];
  const failMail = { on: false };
  const mailer: Mailer = {
    async send(mail) {
      if (failMail.on) throw new Error("SMTP down");
      mails.push(mail);
    },
  };
  let time = Date.parse("2026-10-04T10:00:00Z");
  const app = createApp({
    config: { secureCookies: false, baseUrl: new URL("http://builder.test") },
    db,
    packages: await loadPackages(options.packagesDir ?? DEMO_PACKAGE_DIR, quietLog),
    mailer,
    now: () => new Date(time),
  });
  return {
    app,
    db,
    mails,
    failMail,
    advance: (ms) => {
      time += ms;
    },
    fetch: createApiHandler(app),
  };
}

/** A browser stand-in: keeps the session cookie between requests, like a real one. */
export class Client {
  private cookie: string | undefined;
  private readonly server: TestServer;
  readonly ip: string;

  constructor(server: TestServer, ip = "203.0.113.7") {
    this.server = server;
    this.ip = ip;
  }

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.request(method, path, body, headers);
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
    const json: any = text ? JSON.parse(text) : null;
    return { status: res.status, json, headers: res.headers };
  }

  /** The raw response, for answers that are not JSON (the PDF). */
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h = new Headers({ "x-forwarded-for": this.ip, origin: "http://builder.test", ...headers });
    if (body !== undefined && !h.has("content-type")) h.set("content-type", "application/json");
    if (this.cookie) h.set("cookie", this.cookie);
    const res = await this.server.fetch(
      new Request(`http://builder.test${path}`, {
        method,
        headers: h,
        ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      }),
    );
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? undefined : pair;
    }
    return res;
  }

  /** The session cookie as a `Cookie` header, for a WebSocket handshake. */
  get cookieHeader(): string | undefined {
    return this.cookie;
  }

  get hasSession(): boolean {
    return this.cookie !== undefined;
  }
}

/**
 * Signs up with the address as the way back in and the part before the "@"
 * as the name, and keeps the session; returns the password shown.
 */
export async function signIn(client: Client, email: string, language = "de"): Promise<string> {
  const res = await client.call("POST", "/api/auth/signup", { name: email.split("@")[0], email, language });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.password.secret as string;
}
