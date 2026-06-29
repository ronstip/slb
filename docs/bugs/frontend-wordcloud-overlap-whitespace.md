# Word cloud: overlapping words + dead whitespace, doesn't fill the box

## Symptom

ThemeCloud / word-cloud widget rendered words that **overlapped** each other and
left large **whitespace** around a small central cluster — it never filled the
available space, regardless of word count. Stray single words (e.g. one country
code in a far corner) made it worse.

## Root cause

The layout packed words with d3-cloud at the *container size*, then **upscaled**
the packed result with a transform factor `k` (up to 6×) to "fill" the box
(`ThemeCloud.tsx`, old `setLayoutState({ words, k, ... })` path).

Two failures fell out of that upscale:

1. **Overlap.** d3-cloud's collision detection runs on a coarse low-res sprite
   bitmap. Sub-pixel near-misses are invisible at scale 1, but multiplying every
   position/size by `k` up to 6 magnified them into visibly overlapping glyphs.
2. **Whitespace.** Uniform upscale can't fix an aspect mismatch between the
   packed bounds and the container, and a single stray word inflates the bounds
   so `k = min(w/usedW, h/usedH)` collapses — the dense core renders tiny inside
   a big empty box.

## Fix

Stop upscaling. **Iterate the layout instead** (`ThemeCloud.tsx`): lay out →
measure packed bounds → multiply every font size by the leftover room
(`fill = min(w/usedW, h/usedH) * targetFill`) → re-run. After 2–3 passes the
cloud natively fills the box at scale ≈ 1, so `k` stays 1 — no post-scale to
magnify near-overlaps, and the fonts adapt to the available space. The Style-tab
`scale` prop now feeds `targetFill` (fraction of the box to fill, shrink-only).

Also (earlier in the same session): `spiral('rectangular')→'archimedean'`,
`padding(2)→1`, and vertical-word share 25%→~14% for tighter, centered packing.

## Regression test

Pure-layout logic stays covered by
`frontend/src/features/studio/charts/theme-cloud-model.test.ts` and
`theme-cloud-font.test.ts` (10 tests). The fit loop itself needs a real canvas
(d3-cloud measures glyphs), so it was verified visually via a throwaway
`/dev/wordcloud` route at ~60 words — fills the box, no overlap, minimal
whitespace.

## Fix commit

Branch `feat/shared-dashboard-marketing` (uncommitted at time of writing).
Related history: `docs/bugs/frontend-wordcloud-scrollbar-flicker.md`,
`frontend-word-cloud-font-too-big.md`.
