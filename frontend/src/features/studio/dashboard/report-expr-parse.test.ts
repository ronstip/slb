import { describe, it, expect } from 'vitest';
import { parseExpr, exprToString } from './report-expr-parse.ts';
import { evaluateExpr } from './report-expr.ts';
import type { ExprNode } from './types-social-dashboard.ts';

function ok(src: string): ExprNode {
  const r = parseExpr(src);
  if ('error' in r) throw new Error(`expected parse, got error: ${r.error}`);
  return r.node;
}

describe('parseExpr', () => {
  it('parses a single field ref', () => {
    expect(ok('view_count')).toEqual({ t: 'field', ref: 'view_count' });
  });

  it('parses a number literal', () => {
    expect(ok('100')).toEqual({ t: 'num', v: 100 });
    expect(ok('2.5')).toEqual({ t: 'num', v: 2.5 });
  });

  it('parses a simple ratio', () => {
    expect(ok('engagement_total / view_count')).toEqual({
      t: 'bin', op: '/',
      l: { t: 'field', ref: 'engagement_total' },
      r: { t: 'field', ref: 'view_count' },
    });
  });

  it('respects * / over + - precedence', () => {
    // a + b * c  ->  a + (b * c)
    expect(ok('like_count + comment_count * share_count')).toEqual({
      t: 'bin', op: '+',
      l: { t: 'field', ref: 'like_count' },
      r: {
        t: 'bin', op: '*',
        l: { t: 'field', ref: 'comment_count' },
        r: { t: 'field', ref: 'share_count' },
      },
    });
  });

  it('left-associates same-precedence ops', () => {
    // a - b - c  ->  (a - b) - c
    expect(ok('like_count - comment_count - share_count')).toEqual({
      t: 'bin', op: '-',
      l: {
        t: 'bin', op: '-',
        l: { t: 'field', ref: 'like_count' },
        r: { t: 'field', ref: 'comment_count' },
      },
      r: { t: 'field', ref: 'share_count' },
    });
  });

  it('honours parentheses', () => {
    // (a + b) * c
    expect(ok('(like_count + comment_count) * 2')).toEqual({
      t: 'bin', op: '*',
      l: {
        t: 'bin', op: '+',
        l: { t: 'field', ref: 'like_count' },
        r: { t: 'field', ref: 'comment_count' },
      },
      r: { t: 'num', v: 2 },
    });
  });

  it('parses the percent engagement-rate KPI the old UI could not build', () => {
    const node = ok('(like_count + comment_count + share_count) / view_count * 100');
    // (sum)/views*100 with 10 eng over 100 views -> 10%
    expect(evaluateExpr(node, {
      like_count: 5, comment_count: 3, share_count: 2, view_count: 100,
    })).toBeCloseTo(10);
  });

  it('parses function calls', () => {
    expect(ok('max(like_count, share_count)')).toEqual({
      t: 'fn', fn: 'max',
      args: [{ t: 'field', ref: 'like_count' }, { t: 'field', ref: 'share_count' }],
    });
    expect(ok('abs(like_count - share_count)')).toEqual({
      t: 'fn', fn: 'abs',
      args: [{
        t: 'bin', op: '-',
        l: { t: 'field', ref: 'like_count' },
        r: { t: 'field', ref: 'share_count' },
      }],
    });
  });

  it('rejects an unknown function name', () => {
    expect(parseExpr('sqrt(view_count)')).toHaveProperty('error');
  });

  it('rejects abs with the wrong arity', () => {
    expect(parseExpr('abs(like_count, share_count)')).toHaveProperty('error');
  });

  it('rejects empty / malformed input', () => {
    expect(parseExpr('')).toHaveProperty('error');
    expect(parseExpr('like_count +')).toHaveProperty('error');
    expect(parseExpr('like_count view_count')).toHaveProperty('error');
    expect(parseExpr('(like_count')).toHaveProperty('error');
    expect(parseExpr('* view_count')).toHaveProperty('error');
  });

  it('accepts custom/computed-style ref identifiers', () => {
    expect(ok('custom:roi')).toEqual({ t: 'field', ref: 'custom:roi' });
  });
});

describe('exprToString', () => {
  it('round-trips through parseExpr for editor-producible ASTs', () => {
    const sources = [
      'view_count',
      'engagement_total / view_count',
      'like_count + comment_count * share_count',
      'like_count - comment_count - share_count',
      '(like_count + comment_count) * 2',
      '(like_count + comment_count + share_count) / view_count * 100',
      'max(like_count, share_count)',
      'abs(like_count - share_count)',
    ];
    for (const src of sources) {
      const node = ok(src);
      expect(ok(exprToString(node))).toEqual(node);
    }
  });

  it('only parenthesises where precedence requires it', () => {
    expect(exprToString(ok('like_count + comment_count * share_count')))
      .toBe('like_count + comment_count * share_count');
    expect(exprToString(ok('(like_count + comment_count) * share_count')))
      .toBe('(like_count + comment_count) * share_count');
  });
});
