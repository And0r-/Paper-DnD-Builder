import type { DraftDocument } from "@builder/core";
import { describe, expect, it } from "vitest";
import { combine, pendingOf, rebase, same, sameTarget, toChange } from "./rebase.ts";

const scores = (assign: Record<string, number>, method = 0) => ({ method, assign });
const doc = (answers: Record<string, unknown>, level = 1): DraftDocument => ({ level, answers });

const BEFORE = { brawn: 8, wits: 10, nerve: 12, charm: 10 };
const START = doc({ grit: scores(BEFORE) });

describe("pendingOf", () => {
  it("keeps only the values a distribute answer changed", () => {
    const p = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 8, wits: 9, nerve: 12, charm: 10 }) },
      START,
    );
    expect(p).toEqual({
      type: "assign",
      choice: "grit",
      method: 0,
      assign: { wits: 9 },
      base: { brawn: 8, wits: 10, nerve: 12, charm: 10 },
    });
  });

  it("sends a whole answer when the way of spreading changes", () => {
    const answer = scores({ brawn: 15, wits: 14, nerve: 13, charm: 8 }, 1);
    const p = pendingOf({ type: "answer", choice: "grit", answer }, START);
    expect(p).toMatchObject({ type: "answer", answer, base: START.answers["grit"] });
  });
});

describe("rebase", () => {
  it("puts our value on top of a value someone else changed meanwhile (AND-270)", () => {
    // A is offline and lowers wits; B raises brawn meanwhile.
    const a = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 8, wits: 9, nerve: 12, charm: 10 }) },
      START,
    );
    const server = doc({ grit: scores({ brawn: 9, wits: 10, nerve: 12, charm: 10 }) });
    const r = rebase(a, server);
    expect(r.gaveWay).toBe(false);
    expect(r.alongside).toEqual({ brawn: 9 });
    expect(toChange(r.next!, server)).toEqual({
      type: "answer",
      choice: "grit",
      answer: scores({ brawn: 9, wits: 9, nerve: 12, charm: 10 }),
    });
    // Said once: rebased again on the same state, nothing new.
    expect(rebase(r.next!, server)).toEqual({ next: r.next, gaveWay: false, alongside: {} });
  });

  it("gives way where someone else set the same value", () => {
    const a = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 10, wits: 9, nerve: 12, charm: 10 }) },
      START,
    );
    const server = doc({ grit: scores({ brawn: 9, wits: 10, nerve: 12, charm: 10 }) });
    const r = rebase(a, server);
    expect(r.gaveWay).toBe(true);
    expect(toChange(r.next!, server)).toMatchObject({
      answer: scores({ brawn: 9, wits: 9, nerve: 12, charm: 10 }),
    });
  });

  it("drops what the server already holds, without a conflict", () => {
    const a = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 8, wits: 9, nerve: 12, charm: 10 }) },
      START,
    );
    const server = doc({ grit: scores({ wits: 9, nerve: 12, charm: 10, brawn: 8 }) });
    expect(rebase(a, server)).toEqual({ next: null, gaveWay: false, alongside: {} });
  });

  it("an answer gives way to another answer to the same question", () => {
    const p = pendingOf({ type: "answer", choice: "name", answer: { text: "Ada" } }, doc({}));
    expect(rebase(p, doc({})).next).toBe(p);
    expect(rebase(p, doc({ name: { text: "Ben" } }))).toEqual({ next: null, gaveWay: true, alongside: {} });
  });

  it("a pool and a level give way when theirs changed", () => {
    const pool = pendingOf({ type: "pool", step: "tools", picks: ["a", "b"] }, doc({ t1: { pick: "a" } }), [
      "t1",
      "t2",
    ]);
    expect(rebase(pool, doc({ t1: { pick: "a" } })).next).toBe(pool);
    expect(rebase(pool, doc({ t1: { pick: "a" }, t2: { pick: "c" } })).gaveWay).toBe(true);
    const level = pendingOf({ type: "setLevel", level: 3 }, doc({}, 1));
    expect(rebase(level, doc({}, 1)).next).toBe(level);
    expect(rebase(level, doc({}, 2)).gaveWay).toBe(true);
  });
});

describe("combine", () => {
  it("joins two changes of values on the first one's base", () => {
    const one = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 8, wits: 9, nerve: 12, charm: 10 }) },
      START,
    );
    const between = doc({ grit: scores({ brawn: 8, wits: 9, nerve: 12, charm: 10 }) });
    const two = pendingOf(
      { type: "answer", choice: "grit", answer: scores({ brawn: 8, wits: 9, nerve: 13, charm: 10 }) },
      between,
    );
    expect(sameTarget(one, two)).toBe(true);
    expect(combine(one, two)).toMatchObject({ assign: { wits: 9, nerve: 13 }, base: BEFORE });
  });
});

describe("same", () => {
  it("does not mind the order of keys", () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
  });
});
