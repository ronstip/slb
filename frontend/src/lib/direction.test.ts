import { describe, it, expect } from 'vitest';
import { detectDirection } from './direction.ts';

describe('detectDirection', () => {
  it('returns ltr for English-only text', () => {
    expect(detectDirection(['Hello world, news today'])).toBe('ltr');
  });

  it('returns rtl for Hebrew-majority text', () => {
    expect(detectDirection(['שלום עולם, news today'])).toBe('rtl');
  });

  it('returns rtl for Arabic-majority text', () => {
    expect(detectDirection(['مرحبا بالعالم news'])).toBe('rtl');
  });

  it('returns rtl when RTL share is above 30% threshold', () => {
    // 7 Hebrew letters + 13 latin letters → 35% RTL → rtl
    expect(detectDirection(['שלוםעולם abcdefghijklm'])).toBe('rtl');
  });

  it('returns ltr when RTL share is below 30% threshold', () => {
    // 5 Hebrew letters + 15 latin letters → 25% RTL → ltr
    expect(detectDirection(['שלוםע abcdefghijklmno'])).toBe('ltr');
  });

  it('returns ltr for empty array', () => {
    expect(detectDirection([])).toBe('ltr');
  });

  it('returns ltr when all samples are null/undefined', () => {
    expect(detectDirection([null, undefined, null])).toBe('ltr');
  });

  it('returns ltr for whitespace-only input', () => {
    expect(detectDirection(['   \n\t  '])).toBe('ltr');
  });

  it('returns ltr for numbers and punctuation only', () => {
    expect(detectDirection(['1,234 · 56% — 7.89'])).toBe('ltr');
  });

  it('handles mixed null and string samples', () => {
    expect(detectDirection([null, 'שלום עולם news', undefined])).toBe('rtl');
  });

  it('returns ltr for English UI chrome strings', () => {
    expect(
      detectDirection(['THE BRIEFING', 'MORE STORIES', 'BY THE NUMBERS']),
    ).toBe('ltr');
  });

  it('detects Arabic presentation forms as rtl', () => {
    // U+FE70-U+FEFF range
    expect(detectDirection(['ﻣﺮﺣﺒﺎ ﺑﺎﻟﻌﺎﻟﻢ'])).toBe('rtl');
  });
});
