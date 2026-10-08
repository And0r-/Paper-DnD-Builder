import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import type { Source } from "./channel.ts";
import { personText, toldText, whatText, type Told, type Viewer } from "./words.ts";

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
  choice: (id: string) => ({ "folk.pick": "Herkunft" })[id] ?? null,
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
    expect(whatText({ event: "copies", change: { kind: "copyDeleted", copyId: "c" } }, words, en)).toBe(
      "sheet version",
    );
    expect(whatText({ event: "finished" }, words, de)).toBe("Charakter fertig");
    expect(whatText({ event: "campaign" }, words, de)).toBe("Kampagne");
    expect(whatText({ event: "changed" }, words, de)).toBeNull();
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
