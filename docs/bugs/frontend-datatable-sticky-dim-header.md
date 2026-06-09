# frontend — DataTable pinned (rank/dimension) header cells scroll away on vertical scroll

## Symptom
In dashboard table widgets, on vertical scroll the metric column headers stayed
pinned (sticky `thead`) but the leading **sticky/pinned** column headers (rank
`#` + first dimension) disappeared — the first visible body row's pinned cells
showed in their place. The pinned column kept its body cells but lost its header.

## Root cause — z-index stacking, NOT a missing inset
The `<thead>` is `sticky top-0 z-10`. The pinned body cells (rank + first
dimension) are `position: sticky; left: N; z-10`. Both sit at **z-10**, but the
sticky body cells appear **later in the DOM**, so they win the tie and paint
over the header region.

The pinned header `th` had `z-20` — but that z-index is scoped *inside* the
`thead`'s own stacking context (z-10), so it could never outrank a root-level
z-10 body cell. Non-pinned metric headers were unaffected because their body
cells aren't sticky (z-auto, below the thead).

A geometry check (`getBoundingClientRect().top`) is misleading here: the header
`th` *is* positioned at the top — it's just painted underneath. Only
`elementFromPoint` / a screenshot reveals the real (paint-order) bug.

## Fix
Raise the `thead` stacking context above the pinned body cells: `z-10 → z-20`
in [DataTable.tsx](../../frontend/src/components/DataTable/DataTable.tsx)
(`theadClass`). Verified with the real component + CSS via a temporary
`/dev-table` route driven by Playwright (elementFromPoint at the dim-header
point returns "Dimension" after scrolling; corner stays correct on horizontal
scroll too). A defensive `top: 0` was also added to the pinned header `th`
inline style so it sticks on both axes independently.

## Regression test
None — CSS stacking/positioning, no logic surface. Verified by manual
browser-driven check (Playwright elementFromPoint + screenshot).

## Fix commit
Branch `feat/sharable-report-visibility` (uncommitted at time of writing),
same change set as the mobile fit-4 sizing + equal/value column-width toggle.
