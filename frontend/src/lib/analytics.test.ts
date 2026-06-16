import { describe, it, expect } from 'vitest';
import { shouldLoadAnalytics, parseStoredConsent } from './analytics.ts';

// GA4 must stay dormant unless a Measurement ID is configured, and must never
// fire during the build-time Puppeteer prerender (which would pollute the
// property with synthetic crawler hits and double-count '/' on every deploy).
describe('shouldLoadAnalytics', () => {
  it('is false without a Measurement ID (local dev / un-configured build)', () => {
    expect(shouldLoadAnalytics({ measurementId: undefined, isPrerender: false })).toBe(false);
    expect(shouldLoadAnalytics({ measurementId: '', isPrerender: false })).toBe(false);
  });

  it('is false during the prerender snapshot even with an ID', () => {
    expect(shouldLoadAnalytics({ measurementId: 'G-XXXX', isPrerender: true })).toBe(false);
  });

  it('is true with an ID outside the prerender', () => {
    expect(shouldLoadAnalytics({ measurementId: 'G-XXXX', isPrerender: false })).toBe(true);
  });
});

// Consent Mode v2 defaults to denied; the only way out is a persisted explicit
// choice. Anything we don't recognise is treated as "no choice yet" so the
// banner re-shows rather than silently granting.
describe('parseStoredConsent', () => {
  it('returns null when nothing has been stored (banner should show)', () => {
    expect(parseStoredConsent(null)).toBe(null);
    expect(parseStoredConsent('')).toBe(null);
  });

  it('round-trips the two valid choices', () => {
    expect(parseStoredConsent('granted')).toBe('granted');
    expect(parseStoredConsent('denied')).toBe('denied');
  });

  it('treats anything unrecognised as no-choice (fail safe to denied)', () => {
    expect(parseStoredConsent('yes')).toBe(null);
    expect(parseStoredConsent('true')).toBe(null);
  });
});
