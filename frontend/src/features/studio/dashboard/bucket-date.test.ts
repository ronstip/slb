import { describe, it, expect } from 'vitest';
import { bucketDate } from './dashboard-aggregations.ts';

// Regression: week bucketing must be timezone-stable. All posts in the same
// ISO week (Mon–Sun) must collapse to ONE key regardless of each post's
// time-of-day. The old impl mixed local date math with UTC toISOString() and
// kept the original time, so e.g. a 23:00 post and a 01:00 post in the same
// week produced two different "Monday" keys in non-UTC timezones — inflating
// the point count (30 days showed 9 weekly points instead of ~5).
describe('bucketDate week grouping is timezone-stable', () => {
  it('maps all days of one ISO week to the same Monday, any time-of-day', () => {
    // Week of Mon 2026-05-04 .. Sun 2026-05-10 (UTC)
    const keys = [
      '2026-05-04T00:30:00Z', // Mon, just after midnight
      '2026-05-04T23:45:00Z', // Mon, just before midnight
      '2026-05-06T12:00:00Z', // Wed midday
      '2026-05-10T22:10:00Z', // Sun late
    ].map((d) => bucketDate(d, 'week'));

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('2026-05-04');
  });

  it('separates adjacent weeks into exactly two keys', () => {
    const a = bucketDate('2026-05-10T20:00:00Z', 'week'); // Sun (week of 05-04)
    const b = bucketDate('2026-05-11T01:00:00Z', 'week'); // Mon (week of 05-11)
    expect(a).toBe('2026-05-04');
    expect(b).toBe('2026-05-11');
  });

  it('produces ~5 weekly buckets across a 30-day span, not more', () => {
    const start = Date.parse('2026-05-01T00:00:00Z');
    const keys = new Set<string>();
    for (let i = 0; i < 30; i++) {
      // two posts per day at far-apart hours — the case that used to fragment
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      keys.add(bucketDate(`${day}T01:00:00Z`, 'week'));
      keys.add(bucketDate(`${day}T23:00:00Z`, 'week'));
    }
    expect(keys.size).toBeLessThanOrEqual(6); // 30 days touches at most 6 ISO weeks
  });
});

describe('bucketDate month grouping is timezone-stable', () => {
  it('groups by calendar month regardless of time-of-day', () => {
    expect(bucketDate('2026-05-31T23:30:00Z', 'month')).toBe('2026-05');
    expect(bucketDate('2026-05-01T00:30:00Z', 'month')).toBe('2026-05');
  });
});
