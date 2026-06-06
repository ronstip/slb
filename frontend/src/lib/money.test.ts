import { describe, expect, it } from 'vitest';
import { formatUsdCents, formatUsdMicros } from './money.ts';

describe('formatUsdMicros', () => {
  it('formats micros as dollars', () => {
    expect(formatUsdMicros(3_500_000)).toBe('$3.50');
    expect(formatUsdMicros(0)).toBe('$0.00');
  });

  it('renders $0.00 for non-finite input (no $NaN)', () => {
    // A field a stale backend didn't return arrives as undefined - must never
    // surface as "$NaN" on a KPI card.
    expect(formatUsdMicros(undefined as unknown as number)).toBe('$0.00');
    expect(formatUsdMicros(NaN)).toBe('$0.00');
    expect(formatUsdMicros(null as unknown as number)).toBe('$0.00');
  });
});

describe('formatUsdCents', () => {
  it('formats cents as dollars', () => {
    expect(formatUsdCents(2500)).toBe('$25');
    expect(formatUsdCents(2550)).toBe('$25.50');
  });

  it('renders $0 for non-finite input', () => {
    expect(formatUsdCents(undefined as unknown as number)).toBe('$0');
    expect(formatUsdCents(NaN)).toBe('$0');
  });
});
