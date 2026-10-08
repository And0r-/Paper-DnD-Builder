/**
 * A thin client of the builder's public HTTP API (apps/web/openapi.json),
 * authenticated with an access key. It knows nothing but the base URL and
 * the key: no database, no rule core. What it adds on top of plain HTTP:
 *
 * - the `version` of every character it has seen, sent with each change;
 *   on `409 versionConflict` it takes the current state and says what
 *   changed instead of retrying blindly;
 * - the account (language and units) and each package's texts and
 *   structure, loaded once and kept in memory.
 *
 * The stdio server builds one with Node's `fetch` for the whole process.
 * The HTTP server builds one per request (nothing is kept between requests,
 * so each change reads the character's version afresh) and hands every one
 * the same `PackageCache`, so package texts are loaded once per process.
 */
import type { Units } from "@builder/format/pure";
import type { Account, DraftView, PackageStructure, Texts } from "./api-types.ts";
import { Words } from "./words.ts";

export interface ApiClientOptions {
  /** Where the builder runs, e.g. `https://builder.example.org`. */
  baseUrl: string;
  /** An access key, `cbk_...`. */
  key: string;
  fetch?: typeof fetch;
  /** Package structures and texts to share with other clients; a fresh one if absent. */
  packages?: PackageCache;
}

/**
 * Each package's structure and its texts per language, loaded once. Package
 * data is the same for every account, so clients with different keys can
 * share one cache.
 */
export class PackageCache {
  readonly structures = new Map<string, Promise<PackageStructure>>();
  readonly texts = new Map<string, Promise<Texts>>();
}

/** An answer of the API that is not 2xx, or no answer at all (`status` 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, details: Record<string, unknown> = {}) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** What changed on a character between the state this client last saw and the current one. */
export interface DraftChanges {
  level?: { from: number; to: number };
  status?: { from: string; to: string };
  /** Choice ids whose stored answer was set, changed or removed. */
  answers: string[];
}

/** The result of a change: the new state, or the current one with what moved on if the change was refused. */
export type ChangeResult =
  { applied: true; view: DraftView } | { applied: false; view: DraftView; changedElsewhere: DraftChanges };

export interface FileAnswer {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string | null;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchFn: typeof fetch;
  /** The last state seen per character; its `draft.version` goes with the next change. */
  private readonly seen = new Map<string, DraftView>();
  private accountPromise: Promise<Account> | undefined;
  private readonly packages: PackageCache;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.key = options.key;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.packages = options.packages ?? new PackageCache();
  }

  /** A JSON request; throws `ApiError` for anything but 2xx. */
  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** A file (the PDF). */
  async file(path: string): Promise<FileAnswer> {
    const res = await this.send("GET", path);
    const disposition = res.headers.get("content-disposition") ?? "";
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const ascii = /filename="([^"]+)"/i.exec(disposition)?.[1];
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
      fileName: utf8 ? decodeURIComponent(utf8) : (ascii ?? null),
    };
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    // `x-builder-client` lets the live channel show a change as made over MCP (a label, not a login).
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.key}`,
      "x-builder-client": "mcp",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new ApiError(0, "unreachable", { message: e instanceof Error ? e.message : String(e) });
    }
    if (res.ok) return res;
    let error: { code?: unknown } & Record<string, unknown> = {};
    try {
      const parsed = (await res.json()) as { error?: typeof error };
      error = parsed.error ?? {};
    } catch {
      // Not the API's error shape (a proxy page, for example).
    }
    const { code, ...details } = error;
    throw new ApiError(res.status, typeof code === "string" ? code : `http${res.status}`, details);
  }

  // --- account, packages, texts ---------------------------------------------------------------

  /** The account, loaded once: its language and units decide how texts are written. */
  account(): Promise<Account> {
    this.accountPromise ??= this.json<{ account: Account }>("GET", "/api/account").then((r) => r.account);
    // A failed load (a key withdrawn, the server down) is tried again next time.
    this.accountPromise.catch(() => (this.accountPromise = undefined));
    return this.accountPromise;
  }

  /** A package's structure (units, flow), loaded once per package. */
  structure(packageId: string): Promise<PackageStructure> {
    return remember(this.packages.structures, packageId, () =>
      this.json<{ package: PackageStructure }>("GET", `/api/packages/${enc(packageId)}`).then(
        (r) => r.package,
      ),
    );
  }

  /** All texts of a package in one language, loaded once per package and language. */
  packageTexts(packageId: string, language: string): Promise<Texts> {
    return remember(this.packages.texts, `${packageId}\n${language}`, () =>
      this.json<{ texts: Texts }>("GET", `/api/packages/${enc(packageId)}/texts/${enc(language)}`).then(
        (r) => r.texts,
      ),
    );
  }

  /**
   * The words of a package for this account: its language if the package
   * has it, else the package's first language (never a mix of two).
   */
  async words(packageId: string): Promise<Words> {
    const [account, structure] = await Promise.all([this.account(), this.structure(packageId)]);
    const languages = structure.manifest.languages;
    const language = languages.includes(account.language) ? account.language : (languages[0] ?? "en");
    const texts = await this.packageTexts(packageId, language);
    return new Words({
      texts,
      units: structure.units as Units,
      language,
      preferred: account.units,
    });
  }

  // --- characters -----------------------------------------------------------------------------

  /** Reads a character and remembers its version. */
  async draft(id: string): Promise<DraftView> {
    const view = await this.json<DraftView>("GET", `/api/drafts/${enc(id)}`);
    this.seen.set(id, view);
    return view;
  }

  /** Remembers a state the API answered with (a new character, a list entry is not enough). */
  remember(view: DraftView): void {
    this.seen.set(view.draft.id, view);
  }

  /**
   * Changes a character: `body` goes out with the version last seen (read
   * first if none). A version conflict is not retried: the answer carries
   * the current state and what changed, so the caller decides again.
   */
  async change(
    id: string,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ChangeResult> {
    const before = this.seen.get(id) ?? (await this.draft(id));
    try {
      const view = await this.json<DraftView>(method, path, { ...body, version: before.draft.version });
      this.seen.set(id, view);
      return { applied: true, view };
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "versionConflict") throw e;
      const current = isDraftView(e.details["current"]) ? e.details["current"] : await this.draft(id);
      this.seen.set(id, current);
      return { applied: false, view: current, changedElsewhere: changesBetween(before, current) };
    }
  }
}

export function changesBetween(before: DraftView, after: DraftView): DraftChanges {
  const changes: DraftChanges = { answers: [] };
  if (before.draft.level !== after.draft.level)
    changes.level = { from: before.draft.level, to: after.draft.level };
  if (before.draft.status !== after.draft.status)
    changes.status = { from: before.draft.status, to: after.draft.status };
  const a = before.draft.answers;
  const b = after.draft.answers;
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) changes.answers.push(id);
  }
  return changes;
}

function isDraftView(v: unknown): v is DraftView {
  return typeof v === "object" && v !== null && "draft" in v && "evaluation" in v;
}

function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** One path segment; choice ids of copies carry `@`. */
export function enc(segment: string): string {
  return encodeURIComponent(segment);
}
