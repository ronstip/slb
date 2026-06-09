# frontend: shared link flashes landing page before report

## Symptom
Clicking a shareable link (`/shared/briefing/:token`, `/shared/artifact/:token`,
`/shared/:token`) shows the marketing landing page for ~1s, then "redirects" to
the actual shared report. Bad UX — looks like a wrong page.

## Repro
1. Open a `/shared/...` link in a fresh tab (production build).
2. Observe landing hero paint, then swap to the report.

## Root cause
`vite.config.ts` prerenders route `/` (SEO snapshot via puppeteer), baking the
LandingPage DOM into `dist/index.html`'s `<div id="root">`. The SPA serves that
same `index.html` for ALL paths (fallback), so on a `/shared/...` path the
static landing markup paints first; once `main.tsx` mounts, the router renders
the real shared page — the 1s flash. The shared routes themselves live outside
AuthGate and have no redirect logic, so it was never an auth/redirect bug.

## Fix
Inline synchronous script in `frontend/index.html`, right after `#root` (before
the module script / first paint): if `location.pathname !== '/'`, clear
`#root.innerHTML`. Off the landing route the baked landing markup never paints.
`/` keeps its prerendered SEO HTML + instant paint. `#root` is empty in
dev/un-prerendered builds, so it's a harmless no-op there.

## Regression test
Static HTML / prerender-build behavior — no unit test framework covers it.
Verify manually against a prerendered build (`npm run build` without
`DISABLE_PRERENDER`, serve `dist/`, open a `/shared/...` URL).

## Fix commit
Uncommitted (working tree) — `frontend/index.html`.
