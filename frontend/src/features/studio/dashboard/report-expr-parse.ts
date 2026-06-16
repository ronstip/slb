// Free-form formula <-> ExprNode AST, for the Report Config "Computed Fields"
// editor. The evaluator (report-expr.ts / evaluate_expr) already supports the
// full closed AST — constants, nesting, min/max/abs, any numeric leaf — but the
// old editor only built `leaf OP leaf`. This parser lets the user type the
// expression directly (e.g. `(like_count + comment_count) / view_count * 100`)
// and `exprToString` renders a saved AST back to editable text.
//
// Grammar (recursive descent, standard precedence):
//   expr   := term  (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := number | '(' expr ')' | ident ['(' args ')']
//   args   := expr (',' expr)*
// An `ident` followed by '(' is a function call (min/max/abs); otherwise a field
// ref. Field refs are kept as opaque strings — the editor validates them against
// the known-leaf set so a typo surfaces as a warning, not a parse error.

import type { ExprNode, AnyMetric } from './types-social-dashboard.ts';

export type ParseResult = { node: ExprNode } | { error: string };

const FN_ARITY: Record<string, { min: number; max: number }> = {
  min: { min: 1, max: Infinity },
  max: { min: 1, max: Infinity },
  abs: { min: 1, max: 1 },
};

// ─── Tokenizer ──────────────────────────────────────────────────────────────

type Tok =
  | { k: 'num'; v: number }
  | { k: 'ident'; v: string }
  | { k: 'op'; v: '+' | '-' | '*' | '/' }
  | { k: 'lparen' }
  | { k: 'rparen' }
  | { k: 'comma' };

// Identifier chars allow ':' and '.' so `custom:foo` / `outer.leaf` refs tokenize
// as one identifier.
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_:.]*/y;
const NUM_RE = /\d+(\.\d+)?|\.\d+/y;

function tokenize(src: string): Tok[] | { error: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ k: 'lparen' }); i++; continue; }
    if (c === ')') { toks.push({ k: 'rparen' }); i++; continue; }
    if (c === ',') { toks.push({ k: 'comma' }); i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      toks.push({ k: 'op', v: c }); i++; continue;
    }
    NUM_RE.lastIndex = i;
    const num = NUM_RE.exec(src);
    if (num && num.index === i) {
      toks.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const id = IDENT_RE.exec(src);
    if (id && id.index === i) {
      toks.push({ k: 'ident', v: id[0] });
      i += id[0].length;
      continue;
    }
    return { error: `Unexpected character ${JSON.stringify(c)}` };
  }
  return toks;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

class ParseError extends Error {}

function parseTokens(toks: Tok[]): ExprNode {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExprRule(): ExprNode {
    let left = parseTerm();
    let t = peek();
    while (t && t.k === 'op' && (t.v === '+' || t.v === '-')) {
      next();
      const right = parseTerm();
      left = { t: 'bin', op: t.v, l: left, r: right };
      t = peek();
    }
    return left;
  }

  function parseTerm(): ExprNode {
    let left = parseFactor();
    let t = peek();
    while (t && t.k === 'op' && (t.v === '*' || t.v === '/')) {
      next();
      const right = parseFactor();
      left = { t: 'bin', op: t.v, l: left, r: right };
      t = peek();
    }
    return left;
  }

  function parseFactor(): ExprNode {
    const t = peek();
    if (!t) throw new ParseError('Unexpected end of expression');
    if (t.k === 'num') { next(); return { t: 'num', v: t.v }; }
    if (t.k === 'lparen') {
      next();
      const inner = parseExprRule();
      const close = next();
      if (!close || close.k !== 'rparen') throw new ParseError('Missing closing parenthesis');
      return inner;
    }
    if (t.k === 'ident') {
      next();
      if (peek() && peek().k === 'lparen') {
        const fn = t.v.toLowerCase();
        const arity = FN_ARITY[fn];
        if (!arity) throw new ParseError(`Unknown function ${JSON.stringify(t.v)}`);
        next(); // consume '('
        const args: ExprNode[] = [];
        if (!(peek() && peek().k === 'rparen')) {
          args.push(parseExprRule());
          while (peek() && peek().k === 'comma') { next(); args.push(parseExprRule()); }
        }
        const close = next();
        if (!close || close.k !== 'rparen') throw new ParseError('Missing closing parenthesis');
        if (args.length < arity.min || args.length > arity.max) {
          throw new ParseError(
            `${fn}() takes ${arity.max === Infinity ? `at least ${arity.min}` : arity.min} argument${arity.min === 1 && arity.max === 1 ? '' : 's'}`,
          );
        }
        return { t: 'fn', fn: fn as 'min' | 'max' | 'abs', args };
      }
      return { t: 'field', ref: t.v as AnyMetric };
    }
    throw new ParseError('Expected a value');
  }

  const node = parseExprRule();
  if (pos < toks.length) throw new ParseError('Unexpected trailing input');
  return node;
}

/** Parse a formula string into an ExprNode, or return a human-readable error. */
export function parseExpr(src: string): ParseResult {
  if (!src || src.trim() === '') return { error: 'Expression is empty' };
  const toks = tokenize(src);
  if ('error' in toks) return toks;
  if (toks.length === 0) return { error: 'Expression is empty' };
  try {
    return { node: parseTokens(toks) };
  } catch (e) {
    return { error: e instanceof ParseError ? e.message : 'Invalid expression' };
  }
}

// ─── Serializer (AST -> minimal-parens string) ────────────────────────────────

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** Render an AST back to editable text, parenthesising only where precedence
 *  (or left-associativity of `-` / `/`) would otherwise change meaning. */
export function exprToString(node: ExprNode | undefined | null): string {
  if (!node) return '';
  switch (node.t) {
    case 'num':
      return String(node.v);
    case 'field':
      return String(node.ref);
    case 'fn':
      return `${node.fn}(${(node.args ?? []).map((a) => exprToString(a)).join(', ')})`;
    case 'bin': {
      const myPrec = PREC[node.op];
      // Left child: parenthesise if strictly lower precedence.
      const lStr = wrap(node.l, myPrec, false, node.op);
      // Right child: parenthesise if lower precedence, OR equal precedence under
      // a left-associative op (- or /) so `a - (b - c)` is preserved.
      const rStr = wrap(node.r, myPrec, true, node.op);
      return `${lStr} ${node.op} ${rStr}`;
    }
    default:
      return '';
  }
}

function wrap(child: ExprNode, parentPrec: number, isRight: boolean, parentOp: string): string {
  const s = exprToString(child);
  if (child.t !== 'bin') return s;
  const childPrec = PREC[child.op];
  const needs =
    childPrec < parentPrec ||
    (childPrec === parentPrec && isRight && (parentOp === '-' || parentOp === '/'));
  return needs ? `(${s})` : s;
}
