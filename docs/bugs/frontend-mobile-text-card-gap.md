# Mobile: big empty gap below text card in shared Brief

## Repro
- Add a text card auto-sized to hug a short title (desktop h=1/2).
- Open shared/public dashboard ("Brief") on mobile (<600px).
- Large empty space appears between the text card and the card below it.
- Desktop is fine (recent autosize fix worked there).

## Root cause
`buildCompactLayout` derives the mobile (md/sm/xs) layouts from the lg widgets.
Every non-KPI widget was floored to `Math.max(w.h, 4)` rows — including text
cards. A text card auto-sized to h=1 on desktop got inflated to 4 rows
(~216px) on mobile, leaving empty rows below it. The desktop autosize
(ResizeObserver) only runs on the lg layout, so mobile never shrank back.

## Fix
[buildCompactLayout.ts](../../frontend/src/features/studio/dashboard/buildCompactLayout.ts):
exempt `aggregation === 'text'` widgets from the 4-row floor (minH=1), so the
mobile layout preserves their own auto-sized height.

## Regression test
[SocialDashboardGrid.test.ts](../../frontend/src/features/studio/dashboard/SocialDashboardGrid.test.ts)
— "does not floor a short text card to the 4-row chart minimum".

## Fix commit
Branch `dev`, uncommitted at time of writing.
