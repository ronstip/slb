/**
 * Google Analytics 4 (gtag.js) for the SPA, with Consent Mode v2.
 *
 * Design (mirrors lib/sentry.ts):
 * - **No-op without a Measurement ID.** Local dev and the CI smoke build leave
 *   `VITE_GA_MEASUREMENT_ID` unset, so the tag never loads. The ID itself is a
 *   *public* value (it ships in the client bundle, like the Firebase web key) -
 *   it is not a secret.
 * - **Never fires during prerender.** The build-time Puppeteer snapshot
 *   (`__PRERENDER_INJECTED`) would otherwise pollute the property with
 *   synthetic '/' hits on every deploy.
 * - **Consent Mode v2, BASIC mode (default denied).** We push `consent default`
 *   denied for all storage, then deliberately *do not load the gtag.js library*
 *   until consent is granted. This is stricter than "advanced" consent mode:
 *   pre-consent there are zero network beacons - not even Google's cookieless
 *   modeling pings (scroll, etc.). The cookie banner in `ConsentBanner.tsx`
 *   calls `grantAnalyticsConsent()`, which is what actually injects the
 *   library. Trade-off: no conversion modeling for non-consenting visitors -
 *   acceptable, and matches "send nothing until the user opts in".
 * - **SPA page_views are manual.** `config` runs with `send_page_view: false`
 *   so React Router navigations are the single source of page_view truth (no
 *   double-count of the initial load). See `usePageViews` in the router.
 *
 * `initAnalytics()` is called once before React renders (see main.tsx).
 */

type ConsentChoice = 'granted' | 'denied';

const CONSENT_STORAGE_KEY = 'sl-analytics-consent';

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
    __PRERENDER_INJECTED?: unknown;
  }
}

/**
 * Pure predicate (unit-tested): GA loads only when an ID is configured and we
 * are not inside the prerender snapshot.
 */
export function shouldLoadAnalytics(opts: {
  measurementId: string | undefined;
  isPrerender: boolean;
}): boolean {
  return !!opts.measurementId && !opts.isPrerender;
}

/**
 * Pure parser (unit-tested) for the persisted consent choice. Anything we
 * don't recognise (legacy values, tampering) is treated as "no choice yet" so
 * the banner re-shows and we fail safe to denied.
 */
export function parseStoredConsent(raw: string | null): ConsentChoice | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

function measurementId(): string | undefined {
  return import.meta.env.VITE_GA_MEASUREMENT_ID;
}

function isPrerender(): boolean {
  return typeof window !== 'undefined' && !!window.__PRERENDER_INJECTED;
}

// `configured`: consent defaults armed (ID present, not prerender). Drives the
// banner. `libraryLoaded`: gtag.js has actually been injected - only happens
// once consent is granted (basic consent mode). Hits can only flow when this
// is true.
let configured = false;
let libraryLoaded = false;

/** Whether GA is wired up enough to show the consent banner. */
export function isAnalyticsActive(): boolean {
  return configured;
}

// Mirrors Google's canonical stub exactly: gtag pushes the `arguments` object
// itself onto dataLayer (not an array), so it must be a classic function with
// no rest params for `arguments` to bind correctly.
function gtag() {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

// Typed call alias: the implementation takes no formal params (so `arguments`
// binds), but every call site passes the gtag command tuple.
const g = gtag as unknown as GtagFn;

export function getStoredConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseStoredConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    /* private mode / storage disabled - consent stays session-only */
  }
}

/**
 * Injects gtag.js and runs `config`. Called only once consent is granted, so
 * the very first network beacon GA makes is a consented one. Idempotent.
 */
function loadGtagLibrary(id: string): void {
  if (libraryLoaded) return;
  g('js', new Date());
  // send_page_view: false -> React Router owns page_view (see PageViewTracker).
  g('config', id, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  libraryLoaded = true;
}

/**
 * Arms Consent Mode v2 (all denied) and the gtag stub. Does NOT load the GA
 * library unless consent was already granted in a prior session. No-op when
 * analytics is disabled (no ID) or during prerender. Idempotent.
 */
export function initAnalytics(): void {
  if (configured) return;
  const id = measurementId();
  if (!shouldLoadAnalytics({ measurementId: id, isPrerender: isPrerender() })) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = g;

  // Denied-by-default. `wait_for_update` lets a stored grant land before any
  // beacon. The library itself stays unloaded until consent (basic mode).
  g('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });

  configured = true;

  // Returning visitor who already accepted: lift consent and load immediately
  // so they aren't re-prompted and tracking resumes.
  if (getStoredConsent() === 'granted') {
    g('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
    loadGtagLibrary(id!);
  }
}

/**
 * Visitor accepted: persist, lift consent, and load the GA library (the first
 * time analytics actually starts sending). Caller then sends the first view.
 */
export function grantAnalyticsConsent(): void {
  persistConsent('granted');
  if (!configured) return;
  g('consent', 'update', {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });
  const id = measurementId();
  if (id) loadGtagLibrary(id);
}

/** Visitor declined: persist denied. The GA library is never loaded. */
export function denyAnalyticsConsent(): void {
  persistConsent('denied');
}

/**
 * Manual SPA page_view. No-op until the library is loaded AND consent granted,
 * so pre-consent navigations transmit nothing.
 */
export function trackPageView(path: string, title?: string): void {
  if (!libraryLoaded || getStoredConsent() !== 'granted' || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    ...(title ? { page_title: title } : {}),
  });
}

/**
 * Custom event (conversions, CTA clicks, share-link views). Same consent gate
 * as page_view.
 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!libraryLoaded || getStoredConsent() !== 'granted' || !window.gtag) return;
  window.gtag('event', name, params ?? {});
}
