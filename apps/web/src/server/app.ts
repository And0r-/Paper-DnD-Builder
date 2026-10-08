/**
 * The server application: configuration, database, packages, mail and
 * limits in one object. Route handlers get it from {@link getApp}; tests
 * build their own with {@link createApp} and an in-process database.
 */
import { createSql, sqlExecutor, type SqlExecutor } from "@builder/db";
import { RateLimiter } from "./auth/rate-limit.ts";
import { readConfig, type Config } from "./config.ts";
import { memoryDatabase, outboxMailer, PGLITE_MEMORY_URL } from "./local-backends.ts";
import { createSmtpMailer, type Mailer } from "./mail.ts";
import { LiveChannel, type Role, type Via } from "./live.ts";
import { loadPackages, type PackageRegistry } from "./packages/loader.ts";
import { Store } from "./store.ts";

/** Who made a change, as the live channel shows it (see live.ts). */
export interface ChangeSource {
  via: Via;
  accountId: string;
  accountName: string;
  /** Their access to the character: its owner, or the game master of its campaign. */
  role: Role;
  /** The browser window that made it, if it said so: it skips its own changes. */
  clientId: string | null;
}

/**
 * Something stored about one character: what changed, by whom. The
 * character itself is not in it; a client reads it again when it cares.
 * `version` is the draft's version after the change (unchanged by the
 * play state, copies and the campaign).
 */
export interface DraftEvent {
  type: "created" | "changed" | "levelUp" | "finished" | "state" | "copies" | "campaign" | "deleted";
  draftId: string;
  version: number;
  at: string;
  source: ChangeSource;
  /** What exactly, where it helps: the choice or step answered, the copy, the play state's version. */
  change?: {
    kind: string;
    choice?: string;
    step?: string;
    level?: number;
    copyId?: string;
    stateVersion?: number;
  };
}

/**
 * Notifies about every stored change of a character, wherever the server
 * stores it. The live channel (live.ts) subscribes here and tells everyone
 * on the character, without touching how drafts are changed.
 */
export class DraftEvents {
  private readonly listeners = new Set<(e: DraftEvent) => void>();

  subscribe(listener: (e: DraftEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(e: DraftEvent): void {
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
  live: LiveChannel;
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
  const store = new Store(parts.db);
  const draftEvents = new DraftEvents();
  return {
    config: parts.config,
    store,
    packages: parts.packages,
    mailer: parts.mailer,
    limiter: new RateLimiter(() => now().getTime()),
    draftEvents,
    live: new LiveChannel({ store, now, events: draftEvents }),
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
    const outbox = process.env["MAIL_OUTBOX_DIR"]?.trim();
    if (!outbox && (!config.smtp || !config.mailFrom)) {
      console.error("Mail: SMTP_HOST or MAIL_FROM is not set; game masters cannot add players by address.");
    }
    return createApp({
      config,
      // Local trials and browser tests only; see local-backends.ts.
      db:
        config.databaseUrl === PGLITE_MEMORY_URL
          ? await memoryDatabase()
          : sqlExecutor(createSql(config.databaseUrl)),
      packages,
      mailer: outbox ? outboxMailer(outbox) : createSmtpMailer(config.smtp, config.mailFrom),
    });
  })();
  return holder.__builderApp;
}
