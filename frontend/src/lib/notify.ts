import { toast } from 'sonner';
import { parseError, type ParsedError } from './errors.ts';
import { formatUsdMicros } from './money.ts';
import { openTopUp } from '../features/settings/topup-host.tsx';

/**
 * Unified error notifier. One place that turns any thrown value into a
 * user-facing toast, so failures never sink silently into the console.
 *
 * Design choices (per the toasts spec):
 * - Errors only. Success is usually self-evident; we don't toast it.
 * - Credit problems (`insufficient_credit` / `trial_expired`) get a LONGER
 *   toast plus a "Buy credit" action that opens the top-up dialog in place.
 * - Globally-handled statuses (401 sign-out, `account_blocked` redirect — both
 *   done in api/client.ts) are suppressed here to avoid a redundant toast.
 */

const CREDIT_CODES = new Set(['insufficient_credit', 'trial_expired']);
const SHORT = 5_000;
const LONG = 10_000;

interface ToastPlan {
  title: string;
  durationMs: number;
  withBuyCredit: boolean;
  /** True when client.ts already handles this (redirect/sign-out) → no toast. */
  silent: boolean;
}

/** Map a parsed error to the toast we should show. Exported for tests/reuse. */
export function mapError(p: ParsedError, fallback?: string): ToastPlan {
  const plan = (title: string, opts: Partial<ToastPlan> = {}): ToastPlan => ({
    title,
    durationMs: opts.durationMs ?? SHORT,
    withBuyCredit: opts.withBuyCredit ?? false,
    silent: opts.silent ?? false,
  });

  // Handled elsewhere — stay quiet.
  if (p.status === 401 || p.code === 'account_blocked') return plan('', { silent: true });

  // Credit problems → long toast + Buy-credit action.
  if (CREDIT_CODES.has(p.code ?? '')) {
    const base =
      p.code === 'trial_expired'
        ? 'Your free trial has ended. Add credit to continue.'
        : "You're out of credit. Top up to keep running agents.";
    const suffix =
      typeof p.balanceMicros === 'number' && p.balanceMicros <= 0
        ? ''
        : typeof p.shortfallMicros === 'number' && p.shortfallMicros > 0
          ? ` (need ${formatUsdMicros(p.shortfallMicros)} more)`
          : '';
    return plan(base + suffix, { durationMs: LONG, withBuyCredit: true });
  }

  // Known structured codes.
  switch (p.code) {
    case 'no_runnable_sources':
      return plan('This agent has no keywords or channels to collect. Add at least one.');
    case 'planner_schema_error':
    case 'planner_failed':
      return plan("We couldn't interpret that description. Try rephrasing it.");
  }

  // Status-based fallbacks.
  switch (p.status) {
    case 403:
      return plan("You don't have access to that.");
    case 429:
      return plan("You're going a bit fast — try again in a moment.");
    case 501:
      return plan("Payments aren't enabled yet — please check back soon.");
  }
  if (p.status && p.status >= 500) {
    return plan('Something went wrong on our end. Please try again.');
  }
  if (p.status === undefined && !p.code) {
    // No status → almost always a network/transport failure.
    return plan(fallback ?? 'Network error. Check your connection and try again.');
  }

  return plan(p.message || fallback || 'Something went wrong. Please try again.');
}

/** Surface any error as a toast. Safe to call from anywhere; never throws. */
export function notifyError(err: unknown, fallback?: string): void {
  const plan = mapError(parseError(err), fallback);
  if (plan.silent) return;
  if (plan.withBuyCredit) {
    toast.error(plan.title, {
      duration: plan.durationMs,
      action: { label: 'Buy credit', onClick: () => openTopUp() },
    });
    return;
  }
  toast.error(plan.title, { duration: plan.durationMs });
}
