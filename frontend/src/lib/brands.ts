/**
 * Brand → canonical domain resolution for brand icons.
 *
 * Unlike platforms (a tiny fixed set with bundled SVGs), brands number in the
 * thousands, so we don't ship logos. Instead we map a curated set of known
 * brand names to their domain and resolve a favicon at render time
 * (see BrandIcon.tsx). Names not in the map fall back to a colored initial
 * chip — never blank.
 *
 * Keys are pre-normalized (see `normalizeBrandKey`): lowercase, apostrophes
 * stripped, every other non-alphanumeric run collapsed to a single space.
 * Grow this map as new brands show up in dashboards.
 */
export const BRAND_DOMAINS: Record<string, string> = {
  fifa: 'fifa.com',
  adidas: 'adidas.com',
  nike: 'nike.com',
  puma: 'puma.com',
  'coca cola': 'coca-cola.com',
  hyundai: 'hyundai.com',
  apple: 'apple.com',
  emirates: 'emirates.com',
  visa: 'visa.com',
  'qatar airways': 'qatarairways.com',
  volkswagen: 'volkswagen.com',
  espn: 'espn.com',
  budweiser: 'budweiser.com',
  panini: 'panini.com',
  mcdonalds: 'mcdonalds.com',
  caf: 'cafonline.com',
  'real madrid': 'realmadrid.com',
  sony: 'sony.com',
  'fc barcelona': 'fcbarcelona.com',
  jordan: 'nike.com',
  hisense: 'hisense.com',
  rfef: 'rfef.es',
  'turkish airlines': 'turkishairlines.com',
  'ea sports': 'ea.com',
  telemundo: 'telemundo.com',
  tiktok: 'tiktok.com',
  'brazil national football team': 'cbf.com.br',
  uefa: 'uefa.com',
  powerade: 'powerade.com',
  arsenal: 'arsenal.com',
  'the athletic': 'theathletic.com',
  orange: 'orange.com',
  spotify: 'spotify.com',
  'mercedes benz': 'mercedes-benz.com',
  toyota: 'toyota.com',
  umbro: 'umbro.com',
  peacock: 'peacocktv.com',
  ee: 'ee.co.uk',
};

/**
 * Normalize a raw brand value to a lookup key. Strips apostrophes first
 * (so "McDonald's" -> "mcdonalds", not "mcdonald s"), then collapses any
 * remaining non-alphanumeric run to a single space. Tolerant of casing and
 * punctuation drift in enrichment output ("Coca-Cola" / "coca cola" / "COCA-COLA").
 */
export function normalizeBrandKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Resolve a brand name to its canonical domain, or null if uncovered. */
export function brandDomain(raw: string): string | null {
  return BRAND_DOMAINS[normalizeBrandKey(raw)] ?? null;
}
