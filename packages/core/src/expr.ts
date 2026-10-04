/**
 * Evaluation of package expressions.
 *
 * The format module owns the syntax (parser); this module gives the
 * expressions meaning. It knows nothing about what values or things stand
 * for: names are looked up through a scope the caller provides.
 */
import { parseExpr, type Expr } from "@builder/format/pure";

export type ExprResult = number | boolean | string;

/** What an expression can see of a character. */
export interface ExprScope {
  /** A value by key; `level` included. */
  value(name: string): number;
  has(thingId: string): boolean;
  count(tag: string): number;
}

/**
 * An expression could not be evaluated: wrong types, division by zero,
 * unknown name. The validator rules out most of these, so this means a
 * package bug, not a player mistake.
 */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const parsed = new Map<string, Expr>();

/** Parses once and caches; package expressions repeat a lot. */
function compile(src: string): Expr {
  let expr = parsed.get(src);
  if (!expr) {
    expr = parseExpr(src);
    parsed.set(src, expr);
  }
  return expr;
}

export function evaluate(src: string, scope: ExprScope): ExprResult {
  try {
    return evalNode(compile(src), scope);
  } catch (error) {
    if (error instanceof RuleError) throw new RuleError(`${error.message} in "${src}"`);
    throw error;
  }
}

/** Evaluates a number or a numeric expression. */
export function evaluateNumber(src: string | number, scope: ExprScope): number {
  if (typeof src === "number") return src;
  const r = evaluate(src, scope);
  if (typeof r !== "number") throw new RuleError(`expected a number, got ${typeof r} from "${src}"`);
  return r;
}

export function evaluateCondition(src: string, scope: ExprScope): boolean {
  const r = evaluate(src, scope);
  if (typeof r !== "boolean") throw new RuleError(`expected true or false, got ${typeof r} from "${src}"`);
  return r;
}

function num(v: ExprResult, what: string): number {
  if (typeof v !== "number") throw new RuleError(`${what} needs a number, got ${typeof v}`);
  return v;
}

function bool(v: ExprResult, what: string): boolean {
  if (typeof v !== "boolean") throw new RuleError(`${what} needs true or false, got ${typeof v}`);
  return v;
}

function evalNode(e: Expr, scope: ExprScope): ExprResult {
  switch (e.type) {
    case "num":
    case "str":
    case "bool":
      return e.value;
    case "ref":
      return scope.value(e.name);
    case "unary":
      return e.op === "-" ? -num(evalNode(e.arg, scope), "unary -") : !bool(evalNode(e.arg, scope), "not");
    case "binary": {
      if (e.op === "and")
        return bool(evalNode(e.left, scope), "and") && bool(evalNode(e.right, scope), "and");
      if (e.op === "or") return bool(evalNode(e.left, scope), "or") || bool(evalNode(e.right, scope), "or");
      const l = evalNode(e.left, scope);
      const r = evalNode(e.right, scope);
      if (e.op === "==" || e.op === "!=") {
        if (typeof l !== typeof r) throw new RuleError(`cannot compare ${typeof l} with ${typeof r}`);
        return e.op === "==" ? l === r : l !== r;
      }
      const a = num(l, e.op);
      const b = num(r, e.op);
      switch (e.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) throw new RuleError("division by zero");
          return a / b;
        case "<":
          return a < b;
        case "<=":
          return a <= b;
        case ">":
          return a > b;
        case ">=":
          return a >= b;
      }
      throw new RuleError(`unknown operator ${e.op}`);
    }
    case "call": {
      const arg = (i: number) => evalNode(e.args[i]!, scope);
      switch (e.fn) {
        case "floor":
          return Math.floor(num(arg(0), "floor()"));
        case "ceil":
          return Math.ceil(num(arg(0), "ceil()"));
        case "round":
          return Math.round(num(arg(0), "round()"));
        case "abs":
          return Math.abs(num(arg(0), "abs()"));
        case "min":
          return Math.min(...e.args.map((_, i) => num(arg(i), "min()")));
        case "max":
          return Math.max(...e.args.map((_, i) => num(arg(i), "max()")));
        case "if":
          return bool(arg(0), "if()") ? arg(1) : arg(2);
        case "has":
          return scope.has(String(arg(0)));
        case "count":
          return scope.count(String(arg(0)));
      }
    }
  }
  throw new RuleError("unknown expression");
}
