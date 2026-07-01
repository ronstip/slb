import { describe, expect, it } from 'vitest';
import { isPublicShareRoute } from './public-share-route.ts';

describe('isPublicShareRoute', () => {
  it('matches shared dashboard, briefing, and artifact routes', () => {
    expect(isPublicShareRoute('/shared/abc123')).toBe(true);
    expect(isPublicShareRoute('/shared/briefing/tok')).toBe(true);
    expect(isPublicShareRoute('/shared/artifact/tok')).toBe(true);
  });

  it('does not match app routes that support dark mode', () => {
    expect(isPublicShareRoute('/')).toBe(false);
    expect(isPublicShareRoute('/studio/dashboard')).toBe(false);
    expect(isPublicShareRoute('/manifesto')).toBe(false);
    expect(isPublicShareRoute('/sharedX')).toBe(false);
  });
});
