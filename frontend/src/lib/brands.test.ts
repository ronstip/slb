import { describe, expect, it } from 'vitest';
import { brandDomain, normalizeBrandKey } from './brands.ts';

describe('normalizeBrandKey', () => {
  it('lowercases, strips apostrophes, collapses punctuation', () => {
    expect(normalizeBrandKey("McDonald's")).toBe('mcdonalds');
    expect(normalizeBrandKey('Coca-Cola')).toBe('coca cola');
    expect(normalizeBrandKey('  Qatar  Airways ')).toBe('qatar airways');
  });
});

describe('brandDomain', () => {
  it('uses curated overrides for tricky names', () => {
    expect(brandDomain('Jordan')).toBe('nike.com');
    expect(brandDomain('Coca-Cola')).toBe('coca-cola.com');
    expect(brandDomain('EA Sports')).toBe('ea.com');
  });

  it('falls back to a heuristic <name>.com for uncurated brands', () => {
    expect(brandDomain('Lenovo')).toBe('lenovo.com');
    expect(brandDomain('Verizon')).toBe('verizon.com');
    expect(brandDomain('Aramco')).toBe('aramco.com');
    expect(brandDomain('Capelli Sport')).toBe('capellisport.com');
  });

  it('returns null only when there is nothing to guess from', () => {
    expect(brandDomain('')).toBeNull();
    expect(brandDomain('   ')).toBeNull();
    expect(brandDomain('!!!')).toBeNull();
  });
});
