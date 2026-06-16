# frontend — brand icons missing for some brands

## Symptom
Explorer page → table → Brand column: some brands (Lenovo, Aramco, Verizon,
Capelli Sport, …) rendered a colored initial chip instead of a real logo, while
others (Qatar Airways, Hisense, Hyundai, Puma) showed logos.

## Root cause
`brandDomain()` in `frontend/src/lib/brands.ts` resolved a logo only when the
brand was present in the hand-curated `BRAND_DOMAINS` map. logo.dev's image API
(`img.logo.dev/{domain}`) is domain-only, so the map was the only source of a
domain. Any brand not in the map → `null` → `BrandIcon` fell back to a chip.
The map can't scale to the thousands of brands that show up in dashboards.

## Fix
- `brandDomain()` now falls back to a heuristic `<collapsed-name>.com` guess
  when the brand isn't in the curated map (which is now an OVERRIDE list, only
  for names whose domain isn't `<name>.com`, e.g. jordan → nike.com).
- `BrandIcon.tsx` appends `&fallback=404` to the logo.dev URL so an unknown/
  wrong guessed domain returns 404 (not logo.dev's generic monogram), firing
  `onError` → our colored initial chip. Never blank, never a generic monogram.

Verified lenovo.com / verizon.com / aramco.com / capellisport.com all return
200 from logo.dev.

## Regression test
`frontend/src/lib/brands.test.ts` — covers curated overrides, heuristic
fallback, and null-only-on-empty.

## Commit
Not yet committed (branch `dev`).
