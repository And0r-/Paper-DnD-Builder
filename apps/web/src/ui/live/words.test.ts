import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import type { Source } from "./channel.ts";
import { changedParts, personText, toldText, whatText, withValues, type Told, type Viewer } from "./words.ts";

const de = translator("de").t;
const en = translator("en").t;
const owner: Viewer = { role: "owner", name: "Lio" };
const gm: Viewer = { role: "gameMaster", name: "Vexa" };

function source(over: Partial<Source>): Source {
  return { via: "browser", name: "Lio", role: "owner", clientId: null, connectionId: null, ...over };
}

function told(over: Partial<Told>): Told {
  return { seq: 1, source: source({}), event: "changed", overruled: false, ...over };
}

const words = {
  step: (id: string) => ({ folk: "Herkunft", spells: "Zauber" })[id] ?? null,
  choice: (id: string) => ({ "folk.pick": "Herkunft", scores: "Grundwerte" })[id] ?? null,
  part: (choice: string, id: string) =>
    choice === "scores"
      ? (({ mightBase: "Kraft", witBase: "Witz" } as Record<string, string>)[id] ?? null)
      : null,
  list: (names: string[]) => names.join(" und "),
  level: "Stufe",
};

describe("the line about a change made elsewhere", () => {
  it("names the way and the step: MCP, a program, another window", () => {
    const level = { kind: "level", level: 3 } as const;
    const mcp = told({ source: source({ via: "mcp" }), change: level });
    expect(toldText(mcp, owner, whatText(mcp, words, de), de)).toBe("Über MCP geändert: Stufe");
    const api = told({ source: source({ via: "api" }), change: { kind: "pool", step: "spells" } });
    expect(toldText(api, owner, whatText(api, words, de), de)).toBe("Mit einem Programm geändert: Zauber");
    const win = told({ source: source({ clientId: "w2" }) });
    expect(toldText(win, owner, whatText(win, words, de), de)).toBe("In einem anderen Fenster geändert");
    expect(toldText(win, owner, null, en)).toBe("Changed in another window");
  });

  it("names someone else with their role", () => {
    const byGm = told({
      source: source({ name: "Vexa", role: "gameMaster" }),
      change: { kind: "answer", choice: "folk.pick" },
    });
    expect(toldText(byGm, owner, whatText(byGm, words, de), de)).toBe(
      "Vexa (Spielleitung) hat geändert: Herkunft",
    );
    expect(toldText(byGm, owner, "Origin", en)).toBe("Vexa (game master) made a change: Origin");
    // The game master's own program, seen by the owner.
    const gmMcp = told({ source: source({ name: "Vexa", role: "gameMaster", via: "mcp" }) });
    expect(toldText(gmMcp, owner, null, de)).toBe("Vexa (Spielleitung) hat über MCP geändert");
    // The owner's change, seen by the game master.
    expect(toldText(told({}), gm, null, de)).toBe("Lio hat geändert");
  });

  it("says when this window's own choice gave way", () => {
    const t = told({
      source: source({ name: "Vexa", role: "gameMaster" }),
      change: { kind: "answer", choice: "folk.pick" },
      overruled: true,
    });
    expect(toldText(t, owner, "Herkunft", de)).toBe(
      "Vexa (Spielleitung) hat geändert: Herkunft. Deine Wahl dort gilt nicht mehr.",
    );
    expect(toldText(t, owner, "Origin", en)).toBe(
      "Vexa (game master) made a change: Origin. Your choice there no longer counts.",
    );
  });

  it("words the sheet, a kept version, finishing and the campaign", () => {
    expect(whatText({ event: "playState", change: { kind: "state", stateVersion: 2 } }, words, de)).toBe(
      "Bogen",
    );
    // The sheet names the field: "Ausdauer", not "Bogen".
    const sheetWords = {
      ...words,
      field: (id: string) => ({ "s/stamina": "Ausdauer", "s/luck": "Glück" })[id] ?? null,
    };
    const play = (fields: string[], more = false) =>
      whatText(
        { event: "playState", change: { kind: "state", stateVersion: 2, fields, more } },
        sheetWords,
        de,
      );
    expect(play(["s/stamina"])).toBe("Ausdauer");
    expect(play(["s/luck", "s/stamina"])).toBe("Glück, Ausdauer");
    expect(play(["s/stamina"], true)).toBe("Ausdauer und mehr");
    // A field the shown sheet does not have: the sheet as a whole.
    expect(play(["cards/gone/uses"])).toBe("Bogen");
    expect(whatText({ event: "copies", change: { kind: "copyDeleted", copyId: "c" } }, words, en)).toBe(
      "sheet version",
    );
    expect(whatText({ event: "finished" }, words, de)).toBe("Charakter fertig");
    expect(whatText({ event: "campaign" }, words, de)).toBe("Kampagne");
    expect(whatText({ event: "changed" }, words, de)).toBeNull();
  });

  it("says ours is saved next to values set elsewhere, also when nobody said who (AND-270)", () => {
    const list = (items: string[]) => items.join(", ");
    const scores = { kind: "answer", choice: "folk.pick" } as const;
    const byGm = told({
      source: source({ name: "Vexa", role: "gameMaster" }),
      change: scores,
      alongside: { a: 9 },
      // The changed number is named with its value then, not twice ("Might (Might 9)").
      parts: ["mightBase"],
    });
    const what = withValues(whatText(byGm, words, de), ["Kraft 9"], de, list);
    expect(toldText(byGm, owner, what, de)).toBe(
      "Vexa (Spielleitung) hat geändert: Herkunft (Kraft 9). Deine Wahl ist auch gespeichert.",
    );
    const away = told({ source: null, change: scores, alongside: { a: 9 } });
    expect(toldText(away, owner, withValues(whatText(away, words, en), ["Might 9"], en, list), en)).toBe(
      "Changed elsewhere meanwhile: Herkunft (Might 9). Your choice is saved too.",
    );
    const lost = told({ source: null, change: scores, overruled: true });
    expect(toldText(lost, owner, whatText(lost, words, de), de)).toBe(
      "Inzwischen anderswo geändert: Herkunft. Deine Wahl dort gilt nicht mehr.",
    );
  });
});

describe("what in an answer changed", () => {
  it("finds the numbers, the pick and the picks that changed", () => {
    const before = { method: 0, assign: { mightBase: 8, witBase: 10 } };
    expect(changedParts(before, { method: 0, assign: { mightBase: 12, witBase: 10 } })).toEqual([
      "mightBase",
    ]);
    expect(changedParts(undefined, { method: 0, assign: { mightBase: 8 } })).toEqual(["mightBase"]);
    expect(changedParts({ pick: "a" }, { pick: "b" })).toEqual(["b"]);
    expect(changedParts({ picks: ["a"] }, { picks: ["a", "c"] })).toEqual(["c"]);
    expect(changedParts({ picks: ["a", "c"] }, { picks: ["a"] })).toEqual(["c"]);
    expect(changedParts({ text: "Oda" }, { text: "Brin" })).toEqual([]);
    expect(changedParts({ pick: "a" }, null)).toEqual([]);
  });

  it("names one or two numbers themselves, else the question", () => {
    const mcp = (parts: string[]) =>
      told({ source: source({ via: "mcp" }), change: { kind: "answer", choice: "scores" }, parts });
    const one = mcp(["mightBase"]);
    expect(toldText(one, owner, whatText(one, words, de), de)).toBe("Über MCP geändert: Kraft");
    expect(whatText(mcp(["mightBase", "witBase"]), words, de)).toBe("Kraft und Witz");
    expect(whatText(mcp(["mightBase", "witBase", "graceBase"]), words, de)).toBe("Grundwerte");
    expect(whatText(mcp([]), words, de)).toBe("Grundwerte");
    // A pick is named by its question: "Origin", not the folk picked.
    const pick = told({ change: { kind: "answer", choice: "folk.pick" }, parts: ["folk.moorfolk"] });
    expect(whatText(pick, words, de)).toBe("Herkunft");
  });
});

describe("who else is on the character", () => {
  it("shows a program as connected, without a step", () => {
    expect(personText({ role: "owner", name: "Lio", via: "mcp" }, owner, de)).toBe("Über MCP verbunden");
    expect(personText({ role: "owner", name: "Lio", via: "api" }, owner, en)).toBe("A program is connected");
    expect(personText({ role: "owner", name: "Lio", via: "browser" }, owner, de)).toBe(
      "Du, in einem anderen Fenster",
    );
    expect(personText({ role: "gameMaster", name: "Vexa", via: "mcp" }, owner, de)).toBe(
      "Vexa (Spielleitung), über MCP",
    );
    expect(personText({ role: "helper", name: "Mara", via: "browser" }, owner, de)).toBe("Mara (hilft)");
  });
});
