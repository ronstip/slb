import * as Sentry from '@sentry/react';

/**
 * Sentry initialisation for the SPA.
 *
 * Design (see PRODUCTION_PLAN.md §C.1):
 * - **No-op without a DSN.** Local dev and the CI smoke build leave
 *   `VITE_SENTRY_DSN` unset, so nothing is sent and the SDK stays dormant.
 * - **Errors-only by default.** `traces`/`replay` sample rates default to `0`
 *   and their integrations are only *loaded* when their rate is > 0. At `0`
 *   we send zero spans/replays → the Sentry free plan never bills. Flip the
 *   `VITE_SENTRY_*_SAMPLE_RATE` env vars (e.g. during the Business trial) to
 *   experiment with tracing/replay without a code change.
 *
 * Call once, before React renders (see main.tsx).
 */

function rate(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : 0;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const tracesSampleRate = rate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE);
  const replaysSampleRate = rate(import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE);

  const integrations = [];
  if (tracesSampleRate > 0) integrations.push(Sentry.browserTracingIntegration());
  if (replaysSampleRate > 0) integrations.push(Sentry.replayIntegration());

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations,
    tracesSampleRate,
    // Replay only on sessions that hit an error (when enabled at all) - keeps
    // the 50/mo free-plan cap from draining on healthy sessions.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: replaysSampleRate,
    // We never want emails / tokens / request bodies leaving the client.
    sendDefaultPii: false,
    tags: { service: 'frontend' },
  });
}
