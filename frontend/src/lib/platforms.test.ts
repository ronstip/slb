import { describe, expect, it } from 'vitest';
import { normalizePlatformKey, toPlatformIconKeys } from './platforms.ts';

describe('normalizePlatformKey', () => {
  it('passes through known keys', () => {
    expect(normalizePlatformKey('instagram')).toBe('instagram');
    expect(normalizePlatformKey('youtube')).toBe('youtube');
  });

  it('lowercases and trims', () => {
    expect(normalizePlatformKey('  TikTok ')).toBe('tiktok');
  });

  it('resolves aliases (x -> twitter)', () => {
    expect(normalizePlatformKey('x')).toBe('twitter');
    expect(normalizePlatformKey('Twitter/X')).toBe('twitter');
  });

  it('returns null for unknown / empty', () => {
    expect(normalizePlatformKey('myspace')).toBeNull();
    expect(normalizePlatformKey('')).toBeNull();
    expect(normalizePlatformKey('   ')).toBeNull();
  });
});

describe('toPlatformIconKeys', () => {
  it('dedupes while preserving first-seen order', () => {
    expect(toPlatformIconKeys(['twitter', 'x', 'instagram', 'twitter'])).toEqual([
      'twitter',
      'instagram',
    ]);
  });

  it('drops unknown platforms', () => {
    expect(toPlatformIconKeys(['instagram', 'myspace', 'reddit'])).toEqual([
      'instagram',
      'reddit',
    ]);
  });

  it('returns [] for empty input', () => {
    expect(toPlatformIconKeys([])).toEqual([]);
  });
});
