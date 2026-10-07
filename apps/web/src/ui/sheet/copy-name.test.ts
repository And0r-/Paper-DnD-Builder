import { describe, expect, it } from "vitest";
import { translator } from "../../i18n/index.ts";
import { copyChoice, newestFirst } from "./copy-name.ts";

describe("copies in a list", () => {
  it("say the level they were made at, as the footer does", () => {
    const { t } = translator("de");
    const name = copyChoice(t, "de", "Stufe", { createdAt: "2026-10-07T11:54:00Z", fromLevel: 3 });
    expect(name).toMatch(/^Meine Fassung vom 7\. Oktober, \d\d:54 · Stufe 3$/);
  });

  it("come newest first, whatever order they are given in", () => {
    const a = { id: "a", createdAt: "2026-10-07T13:54:00Z" };
    const b = { id: "b", createdAt: "2026-10-07T13:56:00Z" };
    const c = { id: "c", createdAt: "2026-10-06T09:00:00Z" };
    expect(newestFirst([a, b, c]).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(newestFirst([c, a, b]).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
});
