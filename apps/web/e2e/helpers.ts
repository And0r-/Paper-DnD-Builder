/**
 * Shared pieces of the browser tests:
 *
 * - a `test` whose browser records every request and fails the test if one
 *   leaves the builder's own origin (plan: no calls to other domains),
 * - login through the real screens, with the password read from the mail
 *   folder,
 * - the one-language check: no text of the other language on screen.
 */
import { expect, test as base, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import de from "../src/i18n/messages/de.json" with { type: "json" };
import en from "../src/i18n/messages/en.json" with { type: "json" };

export const OUTBOX = fileURLToPath(new URL("./.outbox/", import.meta.url));
const DEMO_TEXTS = fileURLToPath(new URL("../../../packages/demo-package/texts/", import.meta.url));
export const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));

let ipCounter = 0;

export const test = base.extend<{ foreign: string[] }>({
  // Every test gets its own client address, so the server's per-address limits never interfere.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies
  extraHTTPHeaders: async ({}, use) => {
    ipCounter++;
    await use({ "x-forwarded-for": `198.51.100.${(Date.now() + ipCounter) % 250}` });
  },
  foreign: async ({ page, baseURL }, use) => {
    const own = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (new URL(url).origin !== own) foreign.push(url);
    });
    await use(foreign);
    expect(foreign, "requests to other domains").toEqual([]);
  },
});

export { expect };

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** The newest password mailed to an address (the outbox folder stands in for SMTP). */
export async function passwordFor(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = (await readdir(OUTBOX).catch(() => [])).filter((f) => f.includes(email)).sort();
    const last = files.at(-1);
    if (last) {
      const text = await readFile(join(OUTBOX, last), "utf8");
      const m = /: ([a-zäöüß]+(?:-[a-zäöüß]+){3}-\d{4})$/m.exec(text);
      if (m) return m[1]!;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no password mail to ${email}`);
}

/** Logs in through the screens: address, mail, password. Ends on "My characters". */
export async function login(page: Page, email: string, lang: "de" | "en" = "de"): Promise<void> {
  const m = lang === "de" ? de : en;
  await page.goto("/login");
  if (lang === "en") await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { name: m["login.title"] })).toBeVisible();
  await page.getByLabel(m["login.emailLabel"]).fill(email);
  await page.getByRole("button", { name: m["login.send"] }).click();
  await expect(page.getByRole("heading", { name: m["login.checkTitle"] })).toBeVisible();
  await page.getByLabel(m["login.passwordLabel"]).fill(await passwordFor(email));
  await page.getByRole("button", { name: m["login.submit"], exact: true }).click();
  await expect(page.getByRole("heading", { name: m["characters.title"], level: 1 })).toBeVisible();
}

// ------------------------------------------------------------ one language

type Lang = "de" | "en";

async function packageTexts(lang: Lang): Promise<Record<string, unknown>> {
  const dir = join(DEMO_TEXTS, lang);
  const out: Record<string, unknown> = {};
  for (const f of await readdir(dir)) {
    Object.assign(out, (JSON.parse(await readFile(join(dir, f), "utf8")) as { entries: object }).entries);
  }
  return out;
}

/** Pieces of text that only the given language has: long enough to be telling, absent from the other language. */
async function tellingPieces(lang: Lang): Promise<string[]> {
  const other: Lang = lang === "de" ? "en" : "de";
  const mine = { ...(await packageTexts(lang)), ...(lang === "de" ? de : en) } as Record<string, unknown>;
  const theirs = { ...(await packageTexts(other)), ...(other === "de" ? de : en) } as Record<string, unknown>;
  const theirValues = new Set(
    Object.values(theirs)
      .flat()
      .filter((v) => typeof v === "string") as string[],
  );
  const pieces = new Set<string>();
  for (const [key, value] of Object.entries(mine)) {
    for (const v of [value].flat()) {
      if (typeof v !== "string" || v === theirs[key] || theirValues.has(v)) continue;
      // Split around placeholders and markup; keep the plain runs of words.
      for (const run of v.split(/\{\{[^}]*\}\}|\[\[[^\]]*\]\]|\{[^}]*\}|[.!?:;,()·"„“]/)) {
        const s = run.trim();
        if (s.length >= 5 && /\p{L}{3}/u.test(s)) pieces.add(s);
      }
    }
  }
  return [...pieces];
}

const piecesCache: Partial<Record<Lang, Promise<string[]>>> = {};

/** Visible text, labels and titles of the page, leaving out elements marked as another language. */
async function screenText(page: Page, lang: Lang): Promise<string> {
  return page.evaluate((pageLang) => {
    const out: string[] = [];
    const foreign = (el: Element | null) => {
      const tagged = el?.closest("[lang]");
      return (
        tagged !== null &&
        tagged !== undefined &&
        tagged !== document.documentElement &&
        tagged.getAttribute("lang") !== pageLang
      );
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || foreign(el) || el.closest("script, style, template")) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) {
        // Text only for screen readers counts too.
        if (!el.closest(".visually-hidden")) continue;
      }
      out.push(n.textContent ?? "");
    }
    for (const el of document.querySelectorAll("[aria-label], [title], [placeholder]")) {
      if (foreign(el)) continue;
      for (const a of ["aria-label", "title", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    out.push(document.title);
    return out.join("\n").replace(/\s+/g, " ");
  }, lang);
}

/** Fails if any text of the other language is on screen. Also checks the page declares the right language. */
export async function expectOneLanguage(page: Page, lang: Lang): Promise<void> {
  const other: Lang = lang === "de" ? "en" : "de";
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  piecesCache[other] ??= tellingPieces(other);
  const pieces = await piecesCache[other]!;
  const text = await screenText(page, lang);
  const escape = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole words only: "Talent" must not match inside "Talente".
  const found = pieces.filter((p) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, "u").test(text),
  );
  expect(found, `${other} text on a ${lang} page (${page.url()})`).toEqual([]);
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** A finished level-3 character made through the API, so a test can visit every screen quickly. */
export async function makeCharacter(page: Page, finish = true): Promise<string> {
  const req = page.request;
  const created = await req.post("/api/drafts", { data: { packageId: "demo" } });
  expect(created.status()).toBe(201);
  let view = (await created.json()) as { draft: { id: string; version: number } };
  const id = view.draft.id;
  const patch = await req.patch(`/api/drafts/${id}`, { data: { version: view.draft.version, level: 3 } });
  view = await patch.json();
  const answers: [string, unknown][] = [
    ["folk", { pick: "folk.moorfolk" }],
    ["upbringing", { pick: "upbringing.ferry-child" }],
    ["calling", { pick: "calling.lantern-bearer" }],
    ["talents-lantern-bearer", { picks: ["talent.mending", "talent.climbing"] }],
    ["gear", { pick: "item.reed-shield" }],
    ["knacks-lantern", { picks: ["knack.warm-glow", "knack.glow-thread", "knack.quiet-word"] }],
    ["path", { pick: "path.lightwarden" }],
    ["scores", { method: 0, assign: { might: 8, grace: 7, wit: 9, heart: 11 } }],
    ["extra-talent", { pick: "talent.listening" }],
    ["name", { text: "Mira" }],
    ["age", { value: 20 }],
  ];
  for (const [choice, answer] of answers) {
    const r = await req.put(`/api/drafts/${id}/answers/${choice}`, {
      data: { version: view.draft.version, answer },
    });
    expect(r.status(), choice).toBe(200);
    view = await r.json();
  }
  if (finish) {
    const r = await req.post(`/api/drafts/${id}/finish`, { data: { version: view.draft.version } });
    expect(r.status()).toBe(200);
  }
  return id;
}
