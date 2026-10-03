import { describe, expect, it } from "vitest";
import { evaluate, evaluateCondition, evaluateNumber, RuleError, type ExprScope } from "./index.ts";

// Names and tags as the demo package uses them.
const scope: ExprScope = {
  value: (name) => ({ level: 3, might: 8, heartBonus: 1 })[name] ?? Number.NaN,
  has: (id) => id === "calling.herbalist",
  count: (tag) => (tag === "lantern" ? 2 : 0),
};

describe("evaluate", () => {
  it("computes formulas with the usual precedence", () => {
    expect(evaluateNumber("floor(might / 3) - 2", scope)).toBe(0);
    expect(evaluateNumber("1 + floor(level / 2) + max(0, heartBonus)", scope)).toBe(3);
    expect(evaluateNumber("-might * 2 + 1", scope)).toBe(-15);
    expect(evaluateNumber("min(3, 1 + max(0, heartBonus))", scope)).toBe(2);
    expect(evaluateNumber("if(level >= 2, 3, 2)", scope)).toBe(3);
    expect(evaluateNumber("round(7 / 2) + ceil(0.1) + abs(-1)", scope)).toBe(6);
    expect(evaluateNumber(4, scope)).toBe(4);
  });

  it("evaluates conditions with has() and count()", () => {
    expect(evaluateCondition("has('calling.herbalist') and level >= 3", scope)).toBe(true);
    expect(evaluateCondition("has('calling.river-runner') or not count('lantern') >= 2", scope)).toBe(false);
    expect(evaluateCondition("true != false", scope)).toBe(true);
  });

  it("refuses arithmetic on true/false and other type mix-ups", () => {
    expect(() => evaluate("true + 1", scope)).toThrow(RuleError);
    expect(() => evaluate("level == true", scope)).toThrow(RuleError);
    expect(() => evaluate("if(1, 2, 3)", scope)).toThrow(RuleError);
    expect(() => evaluateNumber("level >= 1", scope)).toThrow(RuleError);
    expect(() => evaluateCondition("level", scope)).toThrow(RuleError);
  });

  it("refuses division by zero and names the expression", () => {
    expect(() => evaluate("might / (level - 3)", scope)).toThrow('division by zero in "might / (level - 3)"');
  });
});
