import { describe, it, expect } from 'vitest';
import { isCustomFieldDimension, getDimensionMeta } from './types-social-dashboard.ts';

describe('isCustomFieldDimension', () => {
  it('returns true for custom-prefixed dimensions', () => {
    expect(isCustomFieldDimension('custom:my_field')).toBe(true);
  });

  it('returns false for standard dimensions', () => {
    expect(isCustomFieldDimension('platform')).toBe(false);
  });

  // Regression: malformed widget configs in saved layouts can have an
  // undefined `dimension`. Crashing here brought down the whole dashboard
  // (TypeError: Cannot read properties of undefined (reading 'startsWith')).
  it('does not crash on undefined/null', () => {
    expect(isCustomFieldDimension(undefined as never)).toBe(false);
    expect(isCustomFieldDimension(null as never)).toBe(false);
  });
});

describe('getDimensionMeta', () => {
  it('returns the standard meta for known dimensions', () => {
    expect(getDimensionMeta('platform').label).toBe('Platform');
  });

  it('returns a fallback meta for undefined/null instead of crashing', () => {
    expect(getDimensionMeta(undefined as never).label).toBeTruthy();
    expect(getDimensionMeta(null as never).label).toBeTruthy();
  });
});
