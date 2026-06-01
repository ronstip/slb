import { PLATFORM_COLORS } from './constants.ts';

/** Icon keys PlatformIcon knows how to render (anything else falls back to a
 *  meaningless grey dot, so we filter those out of source rows). */
const KNOWN_PLATFORM_KEYS = new Set(Object.keys(PLATFORM_COLORS));

/** Aliases that arrive from upstream data but aren't PlatformIcon keys. */
const PLATFORM_ALIASES: Record<string, string> = {
  x: 'twitter',
  'twitter/x': 'twitter',
  yt: 'youtube',
  ig: 'instagram',
  google: 'google_search',
};

/** Map a single raw platform name to a PlatformIcon key, or null if unknown. */
export function normalizePlatformKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const resolved = PLATFORM_ALIASES[key] ?? key;
  return KNOWN_PLATFORM_KEYS.has(resolved) ? resolved : null;
}

/** Normalise a list of raw platform names into deduped, render-ready icon keys,
 *  preserving first-seen order (callers pass them pre-sorted by share). */
export function toPlatformIconKeys(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of names) {
    const key = normalizePlatformKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
