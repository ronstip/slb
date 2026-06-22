# brand-race-video

Isolated [Remotion](https://remotion.dev) project that renders an animated
**brand share-of-voice race** as an MP4 for social marketing. It is a 1:1
animated port of the **"The Race"** marketing board
(`Marketing/checkpoints/wc-brand-leaderboard-v1/board-race.jsx`) — same tokens,
type, logos, and primitives — driven across the five real cumulative checkpoints
(pre-tournament → days 1–4 → 1–7 → 1–11 → 1–12), so brands climb, surge, and
drop out exactly as they did in the published boards.

**Fully self-contained.** Own `package.json` / `node_modules` / bundler. It does
**not** import from or affect `frontend/` or `api/`. Delete this folder and the
app is untouched.

## Quick start

```bash
cd brand-race-video
npm install
npm run dev        # Remotion Studio — live preview + scrubbing
npm run render     # → out/brand-race.mp4  (1080×1350, 4:5, ~16s)
npm run render-hq  # higher quality (crf 16)
```

## Design fidelity (kept in sync with Marketing/)

These mirror the marketing design system — change them there and here together:

| Piece        | Source of truth                          | Here                 |
| ------------ | ---------------------------------------- | -------------------- |
| Colors       | `parts.jsx` `WC_C`                       | `src/theme.ts` `C`   |
| Fonts        | `parts.jsx` `WC_FONT` + Google Fonts     | `src/fonts.ts` `F`   |
| Logo glyphs  | `logos.js` `WC_LOGOS`                    | `src/logos.ts`       |
| Primitives   | `parts.jsx` (Mark, BrandTile, Move, …)   | `src/parts.tsx`      |
| Board layout | `board-race.jsx`                         | `src/BrandRace.tsx`  |
| Data         | `data_pre_tournament/_day4/_day7/_day11` | `src/checkpoints.ts` |

Fonts (Bricolage Grotesque · Fraunces · Inter Tight · JetBrains Mono) load via
`@remotion/google-fonts`. Brands without a glyph (Hisense, Aramco, Lenovo,
Verizon, …) use their logo.dev image, same as the boards — these fetch over the
network at render time.

## Updating the data

Edit `src/checkpoints.ts` — it holds the four checkpoints verbatim from the
`Marketing/.../data_*.js` files. To add a new day, append a checkpoint (and bump
the timeline if needed in `src/engine.ts`). To re-pull from BigQuery instead,
the `social_listening.daily_metrics` TVF gives per-day `top_brands` counts.

## Tuning

All in `src/engine.ts`:

- `FRAMES_PER_ROW` — the speed cap. Each checkpoint-to-checkpoint transition lasts
  `maxRankMove × FRAMES_PER_ROW`, so the fastest-moving row travels at one
  constant rate across the whole video (a big reshuffle gets more time instead of
  zipping). Higher = slower/more relaxed.
- `INTRO` / `HOLD` / `END_HOLD` — dwell on the opening, each intermediate
  checkpoint, and the final standings.
- `SWAP_W` — how smoothly two rows cross when they swap (rank units). Higher =
  softer/longer overlap; lower = crisper/quicker pass. Keep < 1 so settled
  standings stay clean integers.
- `VISIBLE` — rows shown.
- Aspect ratio: `width`/`height` in `src/Root.tsx` (1080×1350 = 4:5 feed;
  1080×1080 = square). Layout constants live at the top of `src/BrandRace.tsx`.
