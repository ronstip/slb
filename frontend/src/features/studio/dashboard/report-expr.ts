// Client-side mirror of the Python expr evaluator in
// api/services/report_transform.py (`evaluate_expr`). An `expr` computed metric
// is aggregate-then-evaluate: the aggregator sums each leaf metric per bucket,
// then evaluates the AST over those per-bucket sums. Division by zero or a
// missing leaf yields null (the bucket is then excluded), matching the server so
// the interactive dashboard, the Brief, and shareable reports agree.
//
// Keep this in lockstep with the Python implementation — the closed node/operator
// set (num, field, bin +-*/, fn min/max/abs) is what makes that parity tractable.

import type { ExprNode, AnyMetric } from './types-social-dashboard.ts';

/** Evaluate the AST over a map of per-bucket aggregated leaf values. Returns
 *  null when any operand is missing or a division by zero occurs. */
export function evaluateExpr(
  node: ExprNode | undefined | null,
  leaves: Record<string, number>,
): number | null {
  if (!node) return null;
  switch (node.t) {
    case 'num':
      return Number.isFinite(node.v) ? node.v : null;
    case 'field': {
      const v = leaves[node.ref];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    case 'bin': {
      const l = evaluateExpr(node.l, leaves);
      const r = evaluateExpr(node.r, leaves);
      if (l === null || r === null) return null;
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? null : l / r;
        default: return null;
      }
    }
    case 'fn': {
      const args = (node.args ?? []).map((a) => evaluateExpr(a, leaves));
      if (args.some((a) => a === null)) return null;
      const nums = args as number[];
      switch (node.fn) {
        case 'min': return nums.length ? Math.min(...nums) : null;
        case 'max': return nums.length ? Math.max(...nums) : null;
        case 'abs': return nums.length ? Math.abs(nums[0]) : null;
        default: return null;
      }
    }
    default:
      return null;
  }
}

/** Distinct leaf metric refs an expression depends on — the metrics the
 *  aggregator must sum per bucket before evaluating. */
export function exprLeafRefs(node: ExprNode | undefined | null): AnyMetric[] {
  const out = new Set<AnyMetric>();
  const walk = (n: ExprNode | undefined | null) => {
    if (!n) return;
    if (n.t === 'field') out.add(n.ref);
    else if (n.t === 'bin') { walk(n.l); walk(n.r); }
    else if (n.t === 'fn') (n.args ?? []).forEach(walk);
  };
  walk(node);
  return [...out];
}
