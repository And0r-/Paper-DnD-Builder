import type { Thing } from "@builder/format/pure";
import { describe, expect, it } from "vitest";
import type { LoadedPackage } from "../packages.ts";
import { longListGroups, SEARCH_FROM } from "./long-list.ts";

const thing = (id: string, rank?: number, group?: string) =>
  ({
    id,
    kind: "knack",
    source: "test",
    ...(rank !== undefined && { rank }),
    ...(group && { group }),
  }) as Thing;

const lp = (texts: Record<string, string>) => ({ lang: "de", texts, pkg: {} }) as unknown as LoadedPackage;

// 120 options over ranks 0 to 9, like the long list of a level-20 character.
const many = Array.from({ length: 120 }, (_, i) => thing(`t${i}`, i % 10));

describe("long option lists", () => {
  it("keeps a short list as the package orders it", () => {
    const few = many.slice(0, SEARCH_FROM - 1);
    const groups = longListGroups(lp({ "rank.name": "Rang" }), few, false, ["t3"], "Empfohlen");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.things.map((t) => t.id)).toEqual(few.map((t) => t.id));
  });

  it("puts the recommended options first, then one group per rank", () => {
    const groups = longListGroups(
      lp({ "rank.name": "Rang", "rank.0.name": "Grundkniffe" }),
      many,
      true,
      ["t3", "t14"],
      "Empfohlen für dich",
    );
    expect(groups.map((g) => g.title)).toEqual([
      "Empfohlen für dich",
      "Grundkniffe",
      ...Array.from({ length: 9 }, (_, i) => `Rang ${i + 1}`),
    ]);
    expect(groups[0]!.things.map((t) => t.id)).toEqual(["t3", "t14"]);
    // A recommended option stands once, at the top.
    expect(groups.flatMap((g) => g.things)).toHaveLength(120);
  });

  it("does not group by rank without a word for it, nor over the package's own groups", () => {
    expect(longListGroups(lp({}), many, true, [], "E").map((g) => g.title)).toEqual([undefined]);
    const grouped = many.map((t, i) => ({ ...t, group: i % 2 ? "a" : "b" }));
    const titles = longListGroups(
      lp({ "rank.name": "Rang", "group.a.name": "A", "group.b.name": "B" }),
      grouped,
      true,
      [],
      "E",
    ).map((g) => g.title);
    expect(titles).toEqual(["B", "A"]);
  });
});
