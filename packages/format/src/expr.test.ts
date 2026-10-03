import { describe, expect, it } from "vitest";
import { collectRefs, ExprSyntaxError, parseExpr } from "./expr.ts";

describe("parseExpr", () => {
  it("respects precedence: * before +, comparison before and/or", () => {
    expect(parseExpr("1 + 2 * level >= 3 and not has('x.y')")).toEqual({
      type: "binary",
      op: "and",
      left: {
        type: "binary",
        op: ">=",
        left: {
          type: "binary",
          op: "+",
          left: { type: "num", value: 1 },
          right: {
            type: "binary",
            op: "*",
            left: { type: "num", value: 2 },
            right: { type: "ref", name: "level" },
          },
        },
        right: { type: "num", value: 3 },
      },
      right: {
        type: "unary",
        op: "not",
        arg: { type: "call", fn: "has", args: [{ type: "str", value: "x.y" }] },
      },
    });
  });

  it("parses functions, unary minus and parentheses", () => {
    expect(parseExpr("if(level >= 2, -(1 + 2), max(a, b, 3))").type).toBe("call");
  });

  it.each([
    ["1 +", "unexpected end of expression"],
    ["floor(1, 2)", "floor() takes 1 argument(s), got 2"],
    ["shout(1)", 'unknown function "shout"'],
    ["has(thing)", "has() takes a quoted string"],
    ["a b", 'unexpected "b" after end of expression'],
    ["a # b", 'unexpected character "#"'],
    ["'open", "unterminated string"],
  ])("rejects %j with a readable message", (src, message) => {
    expect(() => parseExpr(src)).toThrow(ExprSyntaxError);
    expect(() => parseExpr(src)).toThrow(message);
  });

  it("reports the position of the problem", () => {
    try {
      parseExpr("level >= # 2");
      expect.unreachable();
    } catch (e) {
      expect((e as ExprSyntaxError).position).toBe(9);
    }
  });
});

describe("collectRefs", () => {
  it("separates values, things and tags", () => {
    const refs = collectRefs(parseExpr("might + count('lantern') + if(has('a.b'), level, 0)"));
    expect([...refs.values].sort()).toEqual(["level", "might"]);
    expect([...refs.things]).toEqual(["a.b"]);
    expect([...refs.tags]).toEqual(["lantern"]);
  });
});
