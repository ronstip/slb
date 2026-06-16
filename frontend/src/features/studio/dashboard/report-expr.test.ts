import { describe, it, expect } from 'vitest';
import { evaluateExpr, exprLeafRefs } from './report-expr.ts';
import type { ExprNode } from './types-social-dashboard.ts';

// Parity with api/tests/test_report_transform.py (evaluate_expr). Same inputs
// must yield the same outputs so the dashboard, Brief, and shares agree.
describe('evaluateExpr', () => {
  it('computes a ratio', () => {
    const node: ExprNode = { t: 'bin', op: '/',
      l: { t: 'field', ref: 'engagement_total' },
      r: { t: 'field', ref: 'view_count' } };
    expect(evaluateExpr(node, { engagement_total: 10, view_count: 100 })).toBeCloseTo(0.1);
  });

  it('divide by zero → null', () => {
    const node: ExprNode = { t: 'bin', op: '/', l: { t: 'field', ref: 'a' }, r: { t: 'field', ref: 'b' } };
    expect(evaluateExpr(node, { a: 10, b: 0 })).toBeNull();
  });

  it('missing leaf → null', () => {
    expect(evaluateExpr({ t: 'field', ref: 'missing' }, { a: 1 })).toBeNull();
  });

  it('null propagates through ops', () => {
    const node: ExprNode = { t: 'bin', op: '+', l: { t: 'field', ref: 'missing' }, r: { t: 'num', v: 5 } };
    expect(evaluateExpr(node, {})).toBeNull();
  });

  it('fn + nesting', () => {
    const node: ExprNode = { t: 'fn', fn: 'max', args: [
      { t: 'num', v: 2 },
      { t: 'bin', op: '*', l: { t: 'field', ref: 'a' }, r: { t: 'num', v: 3 } },
    ] };
    expect(evaluateExpr(node, { a: 4 })).toBe(12);
    expect(evaluateExpr({ t: 'fn', fn: 'abs', args: [{ t: 'num', v: -7 }] }, {})).toBe(7);
  });

  it('exprLeafRefs collects distinct field refs', () => {
    const node: ExprNode = { t: 'bin', op: '-',
      l: { t: 'field', ref: 'view_count' },
      r: { t: 'fn', fn: 'min', args: [{ t: 'field', ref: 'view_count' }, { t: 'field', ref: 'like_count' }] } };
    expect(exprLeafRefs(node).sort()).toEqual(['like_count', 'view_count']);
  });
});
