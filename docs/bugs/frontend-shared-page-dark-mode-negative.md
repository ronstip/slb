# Shared deliverable renders "negative" (dark-on-dark) in viewer dark mode

## Symptom
On scolto.com public share (`/shared/:token`) opened on an iPhone (or any device)
with OS dark mode, the two-tone hero heading rendered wrong: "World Cup 2026"
(dark ink) was invisible on a darkened background while the orange accent
"Brand Exposure Analysis" stayed visible. Whole page looked inverted / "negative".

## Repro
1. Set OS to dark mode (default app theme is `system`).
2. Open any `/shared/…` dashboard/brief/artifact link.
3. Hero + page chrome flip to dark theme tokens; fixed-dark authored text vanishes.

## Root cause
Share deliverables are authored in a fixed LIGHT palette (cream bg, dark ink
headings, orange accent) and are NOT theme-aware. But both the pre-paint script
in `frontend/index.html` and the runtime `theme-provider.tsx` add the `dark`
class whenever the viewer's OS is dark under the `system` theme. That flipped
`bg-background` dark while the hardcoded-dark title kept its color → invisible.

## Fix
Public `/shared/…` routes now always render light, ignoring stored/system theme.
- `frontend/src/lib/public-share-route.ts` — `isPublicShareRoute(pathname)` helper.
- `theme-provider.tsx` `resolveIsDark()` returns false on share routes (runtime).
- `index.html` pre-paint skips the `dark` class and sets `colorScheme: light`
  on `/shared/` (avoids a dark flash before React mounts).

## Regression test
`frontend/src/lib/public-share-route.test.ts` — asserts `/shared/*` matches and
app routes (`/`, `/studio/...`, `/manifesto`, `/sharedX`) do not.

## Fix commit
Not yet committed (branch `dev`).
