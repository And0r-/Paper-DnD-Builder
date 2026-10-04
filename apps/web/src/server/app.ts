/**
 * The server application: configuration, database, packages, mail and
 * limits in one object. Route handlers get it from {@link getApp}; tests
 * build their own with {@link createApp} and an in-process database.
 */
import { createSql, sqlExecutor, type SqlExecutor } from "@builder/db";
import { RateLimiter } from "./auth/rate-limit.ts";
import { readConfig, type Config } from "./config.ts";
import { createSmtpMailer, type Mailer } from "./mail.ts";
import { loadPackages, type PackageRegistry } from "./packages/loader.ts";
import { Store } from "./store.ts";

export interface DraftChanged {
  draftId: string;
  accountId: string;
  version: number;
}

/**
 * Notifies about every stored draft change. Nothing listens yet; the live
 * help (several people on one draft over WebSocket) will subscribe here and
 * forward changes, without touching how drafts are changed.
 */
export class DraftEvents {
  private readonly listeners = new Set<(e: DraftChanged) => void>();

  subscribe(listener: (e: DraftChanged) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(e: DraftChanged): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (error) {
        console.error("Draft listener failed:", (error as Error).message);
      }
    }
  }
}

export interface App {
  config: Config;
  store: Store;
  packages: PackageRegistry;
  mailer: Mailer;
  limiter: RateLimiter;
  draftEvents: DraftEvents;
  now: () => Date;
}

export interface AppParts {
  config: Config;
  db: SqlExecutor;
  packages: PackageRegistry;
  mailer: Mailer;
  now?: () => Date;
}

export function createApp(parts: AppParts): App {
  const now = parts.now ?? (() => new Date());
  return {
    config: parts.config,
    store: new Store(parts.db),
    packages: parts.packages,
    mailer: parts.mailer,
    limiter: new RateLimiter(() => now().getTime()),
    draftEvents: new DraftEvents(),
    now,
  };
}

// One app per server process; kept on globalThis so dev hot reloads reuse it.
const holder = globalThis as unknown as { __builderApp?: Promise<App> };

export function getApp(): Promise<App> {
  holder.__builderApp ??= (async () => {
    const config = readConfig();
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set. See .env.example.");
    const packages = await loadPackages(config.packagesDir);
    if (!config.smtp || !config.mailFrom) {
      console.error("Mail: SMTP_HOST or MAIL_FROM is not set; nobody can receive a password.");
    }
    return createApp({
      config,
      db: sqlExecutor(createSql(config.databaseUrl)),
      packages,
      mailer: createSmtpMailer(config.smtp, config.mailFrom),
    });
  })();
  return holder.__builderApp;
}
