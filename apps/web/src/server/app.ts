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
import { loadPackages, type PackageRegistry } from "./packages/loader.ts";
import { Store, type DraftRow, type ReachableDraftRow } from "./store.ts";

/** How a change or a connection came in: the browser (cookie), a program with a key, or an MCP program with a key. */
export type Via = "browser" | "api" | "mcp";

/** Who made a change, as the live channel shows it (see live/source.ts). */
export interface ChangeSource {
  via: Via;
  accountId: string;
  accountName: string;
  /** Their access to the character: its owner, the game master of its campaign, or a helper. */
  role: ReachableDraftRow["access"];
  /** The browser window that made it, if it said so (`X-Builder-Client-Id`): it knows its own changes. */
  clientId: string | null;
  /** Set when the change came over the live channel: that connection, and its message's `ref`. */
  connectionId?: string | undefined;
  ref?: string | undefined;
}

/** What a draft change was, for the screen: the choice or step answered, the level. */
export interface DraftCause {
  type: "changed" | "levelUp" | "finished";
  change?:
    | { kind: "answer"; choice: string }
    | { kind: "pool"; step: string }
    | { kind: "level" | "levelUp"; level: number };
}

/** A stored draft changed; `row` is the draft as stored now. */
export interface DraftChanged extends DraftCause {
  kind: "draft";
  draftId: string;
  accountId: string;
  version: number;
  row: DraftRow;
  /** The level a raise started from, when the change finished it at once (see `draftView`). */
  raisedFrom?: number | undefined;
  source: ChangeSource;
}

/**
 * Something else stored about a character that does not change the draft
 * itself: its play state, its sheet copies, its campaign, or it was deleted.
 */
export interface CharacterChanged {
  kind: "character";
  type: "state" | "copies" | "campaign" | "deleted";
  draftId: string;
  source: ChangeSource;
  change?:
    | { kind: "state" | "clearChecks"; stateVersion: number }
    | { kind: "copyCreated" | "copyChanged" | "copyDeleted"; copyId: string };
}

/**
 * What happens to drafts that the live channel passes on: a change of the
 * draft, another change of the character, or a change of who may reach
 * drafts (a help link made or withdrawn, a campaign left, a login ended).
 * `draftId` undefined: any draft.
 */
export type DraftEvent = DraftChanged | CharacterChanged | { kind: "access"; draftId?: string | undefined };

/**
 * Notifies about every stored change of a character, however it was made. The live help (live/hub.ts)
 * subscribes here and forwards changes to everyone on the draft, without
 * touching how drafts are changed.
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
