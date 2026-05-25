# frontend: shared dashboard had horizontal scroll on mobile + no side margins

## Symptom

Opening `/shared/<token>` on iPhone 12 Pro (390px viewport) showed:

- A persistent horizontal scrollbar — page rendered ~1280px wide regardless of
  viewport.
- No horizontal padding around the dashboard content (KPIs/charts butting up to
  the screen edge).
- KPI cards crammed into a single row at ~1/4 viewport each, truncating the
  formatted number (e.g. `188.9M` → `188.9|`).

## Repro

1. Open any shared dashboard link in mobile device emulation (≤ 480px).
2. Observe horizontal scroll + cramped KPI row.

## Root cause

Three layered issues:

1. **Global body min-width.**
   [frontend/src/styles/globals.css](frontend/src/styles/globals.css#L168-L176)
   sets `body { min-width: 1280px }` for desktop-only surfaces. The shared
   *artifact* page already overrides this on mount
   ([SharedArtifactPage.tsx](frontend/src/features/artifacts/SharedArtifactPage.tsx#L52)),
   but the shared *dashboard* page never did — so body stayed pinned at 1280px,
   forcing the whole page wider than the viewport.
2. **No page padding.** `<main>` and the filter-bar wrapper in
   [SharedDashboardPage.tsx](frontend/src/features/studio/dashboard/SharedDashboardPage.tsx)
   lacked `px-*`, so content sat flush against the viewport edges once the
   width was correct.
3. **KPI compact layout crammed cards into too-narrow cells.**
   `buildCompactLayout` divided cols evenly across all designed-row KPIs even
   when the result was < 2 cols per card. At `sm` (4 cols) with 3 KPIs each card
   got 1 col (~80px) — the number formatter then overflowed.

## Fix

1. [SharedDashboardPage.tsx](frontend/src/features/studio/dashboard/SharedDashboardPage.tsx)
   — same pattern as `SharedArtifactPage`: set `document.body.style.minWidth =
   '0'` on mount, restore on unmount. Added `px-3 sm:px-6` to `<main>` and the
   filter-bar inner wrapper.
2. [buildCompactLayout.ts](frontend/src/features/studio/dashboard/buildCompactLayout.ts)
   — KPI rows now wrap to extra rows when cards would be < 2 cols wide. At `xs`
   (2 cols) each KPI is full width and stacks; at `sm` (4 cols) two cards per
   row.

## Regression test

[SocialDashboardGrid.test.ts](frontend/src/features/studio/dashboard/SocialDashboardGrid.test.ts)
— added cases for the wrap behaviour at narrow cols, full-width stacking at the
narrowest breakpoint, and a "following widget sits below wrapped KPI rows"
check that guards against overlap with the next chart.

The body-min-width fix is verified manually under Playwright at 390×844
(`document.documentElement.scrollWidth` matches `window.innerWidth` after
mount).

## Commit

Branch `dev` (uncommitted at time of writing).
