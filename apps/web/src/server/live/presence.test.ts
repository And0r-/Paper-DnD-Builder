import { describe, expect, it } from "vitest";
import { Presence } from "./presence.ts";

const MIN = 60_000;

describe("presence", () => {
  it("counts each session once, with a request in the last 10 minutes", () => {
    let now = Date.parse("2026-10-04T10:02:00Z");
    const p = new Presence(() => now);
    p.touch("a");
    p.touch("a");
    p.touch("b");
    expect(p.activeNow()).toBe(2);
    now += 9 * MIN;
    p.touch("c");
    expect(p.activeNow()).toBe(3);
  });

  it("keeps times to 5 minutes, rounded down", () => {
    let now = Date.parse("2026-10-04T10:04:59Z");
    const p = new Presence(() => now);
    p.touch("a");
    // Seen at 10:00 as far as it knows: at 10:10 it is still in the last 10 minutes, at 10:15 no more.
    now = Date.parse("2026-10-04T10:14:59Z");
    expect(p.activeNow()).toBe(1);
    now = Date.parse("2026-10-04T10:15:00Z");
    expect(p.activeNow()).toBe(0);
  });

  it("forgets sessions older than 15 minutes when it counts", () => {
    let now = Date.parse("2026-10-04T10:00:00Z");
    const p = new Presence(() => now);
    p.touch("a");
    now = Date.parse("2026-10-04T10:15:00Z");
    p.touch("b");
    // "a" no longer counts, but is kept until it is older than 15 minutes.
    expect(p.activeNow()).toBe(1);
    expect(p.size).toBe(2);
    now += 1000;
    expect(p.activeNow()).toBe(1);
    expect(p.size).toBe(1);
  });
});
