/**
 * Expression language for conditions and formulas in packages.
 *
 * The format owns the syntax (this parser); the rule core owns evaluation.
 * The language is deliberately tiny and rule-system neutral: numbers,
 * strings, booleans, references to values, arithmetic, comparisons, logic
 * and a fixed set of functions. See SPEC.md, section "Expressions".
 */

export type Expr =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "ref"; name: string }
  | { type: "unary"; op: "-" | "not"; arg: Expr }
  | { type: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { type: "call"; fn: FunctionName; args: Expr[] };

export type BinaryOp = "+" | "-" | "*" | "/" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

/** Functions every rule core must implement, with their arity (min, max). */
export const FUNCTIONS = {
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 1],
  abs: [1, 1],
  min: [2, Infinity],
  max: [2, Infinity],
  if: [3, 3],
  /** `has("thing.id")`: true if the character currently has that thing. */
  has: [1, 1],
  /** `count("tag")`: number of things the character has that carry the tag. */
  count: [1, 1],
} as const satisfies Record<string, readonly [number, number]>;

export type FunctionName = keyof typeof FUNCTIONS;

/** Identifiers that always exist and need no declaration. */
export const BUILTIN_REFS = ["level"] as const;

export class ExprSyntaxError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "ExprSyntaxError";
    this.position = position;
  }
}

type Token =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "end"; p: number };

const OPERATORS = ["<=", ">=", "==", "!=", "+", "-", "*", "/", "<", ">", "(", ")", ","];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      tokens.push({ t: "num", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprSyntaxError("unterminated string", i);
      tokens.push({ t: "str", v: src.slice(i + 1, end), p: i });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprSyntaxError(`unexpected character "${c}"`, i);
    tokens.push({ t: "op", v: op, p: i });
    i += op.length;
  }
  tokens.push({ t: "end", p: src.length });
  return tokens;
}

/** Parses an expression. Throws {@link ExprSyntaxError} with a position on bad input. */
export function parseExpr(src: string): Expr {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === "op" && t.v === v;
  };
  const isWord = (v: string) => {
    const t = peek();
    return t.t === "id" && t.v === v;
  };
  const expectOp = (v: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new ExprSyntaxError(`expected "${v}"`, t.p);
  };

  const parseOr = (): Expr => {
    let left = parseAnd();
    while (isWord("or")) {
      next();
      left = { type: "binary", op: "or", left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Expr => {
    let left = parseNot();
    while (isWord("and")) {
      next();
      left = { type: "binary", op: "and", left, right: parseNot() };
    }
    return left;
  };
  const parseNot = (): Expr => {
    if (isWord("not")) {
      next();
      return { type: "unary", op: "not", arg: parseNot() };
    }
    return parseCompare();
  };
  const parseCompare = (): Expr => {
    const left = parseAdd();
    const t = peek();
    if (t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      next();
      return { type: "binary", op: t.v as BinaryOp, left, right: parseAdd() };
    }
    return left;
  };
  const parseAdd = (): Expr => {
    let left = parseMul();
    while (isOp("+") || isOp("-")) {
      const op = (next() as { v: "+" | "-" }).v;
      left = { type: "binary", op, left, right: parseMul() };
    }
    return left;
  };
  const parseMul = (): Expr => {
    let left = parseUnary();
    while (isOp("*") || isOp("/")) {
      const op = (next() as { v: "*" | "/" }).v;
      left = { type: "binary", op, left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Expr => {
    if (isOp("-")) {
      next();
      return { type: "unary", op: "-", arg: parseUnary() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): Expr => {
    const t = next();
    if (t.t === "num") return { type: "num", value: t.v };
    if (t.t === "str") return { type: "str", value: t.v };
    if (t.t === "op" && t.v === "(") {
      const inner = parseOr();
      expectOp(")");
      return inner;
    }
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { type: "bool", value: t.v === "true" };
      if (["and", "or", "not"].includes(t.v)) throw new ExprSyntaxError(`unexpected "${t.v}"`, t.p);
      if (isOp("(")) {
        next();
        if (!(t.v in FUNCTIONS)) {
          throw new ExprSyntaxError(
            `unknown function "${t.v}" (known: ${Object.keys(FUNCTIONS).join(", ")})`,
            t.p,
          );
        }
        const fn = t.v as FunctionName;
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(parseOr());
          while (isOp(",")) {
            next();
            args.push(parseOr());
          }
        }
        expectOp(")");
        const [min, max] = FUNCTIONS[fn];
        if (args.length < min || args.length > max) {
          const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}-${max}`;
          throw new ExprSyntaxError(`${fn}() takes ${want} argument(s), got ${args.length}`, t.p);
        }
        if ((fn === "has" || fn === "count") && args[0]!.type !== "str") {
          throw new ExprSyntaxError(`${fn}() takes a quoted string, e.g. ${fn}("some.id")`, t.p);
        }
        return { type: "call", fn, args };
      }
      return { type: "ref", name: t.v };
    }
    if (t.t === "end") throw new ExprSyntaxError("unexpected end of expression", t.p);
    throw new ExprSyntaxError(`unexpected "${t.v}"`, t.p);
  };

  const result = parseOr();
  const rest = peek();
  if (rest.t !== "end") {
    throw new ExprSyntaxError(`unexpected "${"v" in rest ? rest.v : ""}" after end of expression`, rest.p);
  }
  return result;
}

/** What an expression refers to; used for validation and dependency tracking. */
export interface ExprRefs {
  values: Set<string>;
  things: Set<string>;
  tags: Set<string>;
}

export function collectRefs(expr: Expr, into: ExprRefs = emptyRefs()): ExprRefs {
  switch (expr.type) {
    case "ref":
      into.values.add(expr.name);
      break;
    case "unary":
      collectRefs(expr.arg, into);
      break;
    case "binary":
      collectRefs(expr.left, into);
      collectRefs(expr.right, into);
      break;
    case "call": {
      const first = expr.args[0];
      if (expr.fn === "has" && first?.type === "str") into.things.add(first.value);
      else if (expr.fn === "count" && first?.type === "str") into.tags.add(first.value);
      else for (const a of expr.args) collectRefs(a, into);
      break;
    }
    default:
      break;
  }
  return into;
}

function emptyRefs(): ExprRefs {
  return { values: new Set(), things: new Set(), tags: new Set() };
}
