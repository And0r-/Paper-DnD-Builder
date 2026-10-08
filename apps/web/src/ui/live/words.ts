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

/** What it was about, in the screen's words; null when the channel did not say. */
export function whatText(
  told: Pick<Told, "event" | "change">,
  words: { step(id: string): string | null; choice(id: string): string | null; level: string },
  t: T,
): string | null {
  if (told.event === "finished") return t("live.what.finished");
  if (told.event === "campaign") return t("live.what.campaign");
  const c = told.change;
  if (!c) return null;
  switch (c.kind) {
    case "answer":
      return words.choice(c.choice);
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
