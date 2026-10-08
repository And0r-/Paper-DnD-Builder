/**
 * The words for what others do on the same character: a short line about a
 * change ("Vexa (game master) made a change: Origin", "Changed over MCP:
 * Level") and how someone is on it ("Connected over MCP").
 *
 * "The same account" needs no account id, which never goes over the
 * channel: a character has one owner and at most one game master, so a
 * change in the viewer's own role and name is the viewer's own, made in
 * another window or by a program of theirs.
 */
import type { Translator } from "../../i18n/index.ts";
import type { Change, Person, Role, Source } from "./channel.ts";

type T = Translator["t"];

/** Whoever looks at the screen. */
export interface Viewer {
  role: Role;
  name: string;
}

/** What the channel told, kept for the short line. */
export interface Told {
  /** Counts up: the same words again are still a new line. */
  seq: number;
  source: Source;
  event: "changed" | "levelUp" | "finished" | "playState" | "copies" | "campaign";
  change?: Change | undefined;
  /**
   * For an answer: the parts of it that changed, as far as this window
   * can tell from the answer before and after (see `changedParts`).
   */
  parts?: string[] | undefined;
  /** This window's own answer to the same question was not saved yet: the stored one counts. */
  overruled: boolean;
}

function sameAccount(p: { role: Role; name: string }, viewer: Viewer): boolean {
  return p.role === viewer.role && p.name === viewer.name;
}

/** Who made it and how: "Changed in another window", "Vexa (game master) made a change". */
export function fromText(source: Source, viewer: Viewer, t: T): string {
  if (sameAccount(source, viewer)) {
    if (source.via === "mcp") return t("live.from.mcp");
    if (source.via === "api") return t("live.from.api");
    return t("live.from.window");
  }
  const who = t(`live.person.${source.role}`, { name: source.name });
  if (source.via === "mcp") return t("live.from.personMcp", { who });
  if (source.via === "api") return t("live.from.personApi", { who });
  return t("live.from.person", { who });
}

/**
 * What in an answer changed, from the answer before and after: the picks
 * that came in (or, if none did, those that went), the numbers handed out
 * that differ ("mightBase"). Empty for a text or a number, and when the
 * shapes do not say: the answer as a whole changed then.
 */
export function changedParts(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  if (typeof a["pick"] === "string") return a["pick"] !== b["pick"] ? [a["pick"]] : [];
  const picks = (x: unknown) => (Array.isArray(x) ? x.filter((p): p is string => typeof p === "string") : []);
  if (Array.isArray(a["picks"]) || Array.isArray(b["picks"])) {
    const was = picks(b["picks"]);
    const now = picks(a["picks"]);
    const came = now.filter((p) => !was.includes(p));
    return came.length > 0 ? came : was.filter((p) => !now.includes(p));
  }
  const record = (x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  if (a["assign"] !== undefined || b["assign"] !== undefined) {
    const was = record(b["assign"]);
    const now = record(a["assign"]);
    return [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
  }
  return [];
}

/** What it was about, in the screen's words; null when the channel did not say. */
export function whatText(
  told: Pick<Told, "event" | "change" | "parts">,
  words: {
    step(id: string): string | null;
    choice(id: string): string | null;
    /** A number of a question that hands them out, by name ("Might"); null for anything else. */
    part(choice: string, id: string): string | null;
    list(names: string[]): string;
    level: string;
  },
  t: T,
): string | null {
  if (told.event === "finished") return t("live.what.finished");
  if (told.event === "campaign") return t("live.what.campaign");
  const c = told.change;
  if (!c) return null;
  switch (c.kind) {
    case "answer": {
      // One or two numbers are named themselves ("Might"); more, or a pick, and the question's title says it.
      const names = (told.parts ?? []).map((p) => words.part(c.choice, p));
      if (names.length > 0 && names.length <= 2 && names.every((n) => n))
        return words.list(names as string[]);
      return words.choice(c.choice);
    }
    case "pool":
      return words.step(c.step);
    case "level":
    case "levelUp":
      return words.level;
    case "state":
    case "clearChecks":
      return t("live.what.play");
    case "copyCreated":
    case "copyChanged":
    case "copyDeleted":
      return t("live.what.copy");
  }
}

/** The whole line: who and how, what, and whether this window's own choice there gave way. */
export function toldText(told: Told, viewer: Viewer, what: string | null, t: T): string {
  const from = fromText(told.source, viewer, t);
  const line = what ? t("live.told.line", { from, what }) : from;
  return told.overruled ? t("live.told.overruled", { line }) : line;
}

/** How someone else on the character is named in "Here now". */
export function personText(p: Pick<Person, "role" | "name" | "via">, viewer: Viewer, t: T): string {
  if (sameAccount(p, viewer)) {
    if (p.via === "mcp") return t("live.person.mcp");
    if (p.via === "api") return t("live.person.api");
    return t("live.person.window");
  }
  const who = t(`live.person.${p.role}`, { name: p.name });
  if (p.via === "mcp") return t("live.person.viaMcp", { who });
  if (p.via === "api") return t("live.person.viaApi", { who });
  return who;
}
