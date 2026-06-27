/**
 * Headless render target for one watch widget.
 *
 * The render service (Node + Playwright) loads `/embed/watch-widget?token=…`,
 * waits for `window.__alertRenderReady`, and screenshots `#alert-widget-capture`.
 * There is no logged-in user here: the page authenticates to the API with the
 * opaque render token (scoped to one watch + widget + firing window) and renders
 * the REAL dashboard widget component, so the email image is pixel-identical to
 * the app. (Ported from AlertWidgetEmbed — keeps the same ready-signal contract
 * the render service already waits on.)
 *
 * Not a normal app route — it carries no chrome and must stay outside AuthGate.
 */
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocialWidgetRenderer } from '../studio/dashboard/SocialWidgetRenderer.tsx';
import type { SocialDashboardWidget } from '../studio/dashboard/types-social-dashboard.ts';
import type { DashboardPost } from '../../api/types.ts';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

interface RenderPayload {
  widget: SocialDashboardWidget;
  posts: DashboardPost[];
  watch_name: string;
  app_url: string;
}

const noop = () => {};

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function WidgetCanvas({ payload, width, height }: { payload: RenderPayload; width: number; height: number }) {
  // Signal the screenshotter once the widget has painted. A double rAF flushes
  // layout; the timeout lets Recharts finish its entry animation so we capture
  // the final frame, not a mid-tween one.
  useEffect(() => {
    let raf = 0;
    const timer = window.setTimeout(() => {
      (window as unknown as { __alertRenderReady?: boolean }).__alertRenderReady = true;
      document.body.setAttribute('data-alert-render-ready', '1');
    }, 750);
    raf = requestAnimationFrame(() => requestAnimationFrame(noop));
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      id="alert-widget-capture"
      style={{
        width,
        height,
        background: 'var(--card, #ffffff)',
        borderRadius: 14,
        border: '1px solid var(--border, #E5DFD2)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: 16,
      }}
    >
      <SocialWidgetRenderer
        widget={payload.widget}
        filteredPosts={payload.posts}
        topics={[]}
        isEditMode={false}
        onConfigure={noop}
        onRemove={noop}
      />
    </div>
  );
}

export function WatchWidgetEmbed() {
  const [payload, setPayload] = useState<RenderPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const width = clampInt(params.get('w'), 1000, 320, 1600);
  const height = clampInt(params.get('h'), 420, 160, 1200);

  useEffect(() => {
    if (!token) {
      setError('missing token');
      (window as unknown as { __alertRenderError?: string }).__alertRenderError = 'missing token';
      return;
    }
    const url = new URL(`${API_BASE}/watch-render/payload`, window.location.origin);
    url.searchParams.set('token', token);
    fetch(url.toString(), { headers: { 'Content-Type': 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`payload ${res.status}`);
        return res.json();
      })
      .then((data: RenderPayload) => setPayload(data))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'render payload failed';
        setError(msg);
        (window as unknown as { __alertRenderError?: string }).__alertRenderError = msg;
      });
  }, [token]);

  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ display: 'inline-block', background: 'transparent', padding: 0, margin: 0 }}>
        {error ? (
          <div id="alert-widget-error" style={{ padding: 24, fontFamily: 'sans-serif', color: '#E05555' }}>
            Unable to render widget: {error}
          </div>
        ) : payload ? (
          <WidgetCanvas payload={payload} width={width} height={height} />
        ) : (
          <div style={{ width, height }} />
        )}
      </div>
    </QueryClientProvider>
  );
}
