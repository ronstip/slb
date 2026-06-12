import type { LayoutItem } from 'react-grid-layout';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

// Below this card width the KPI value gets truncated on mobile, so we wrap
// the designed row across additional rows instead of cramming.
const MIN_KPI_W = 2;

// Grid geometry - keep in sync with SocialDashboardGrid (ROW_HEIGHT, MARGIN).
const ROW_HEIGHT_PX = 48;
const MARGIN_Y_PX = 14;

export interface CompactLayoutOptions {
  /** Media-widget id → intrinsic aspect ratio (natural width / height). Lets a
   *  media cell be sized to the image/video's own proportions on compact
   *  breakpoints instead of inheriting the desktop row count, which would
   *  crop a wide banner into a near-square box (object-cover) on mobile. */
  mediaAspect?: Record<string, number>;
  /** Pixel width of a full-width cell (grid container width minus its
   *  horizontal padding). Combined with `mediaAspect` to derive the row count
   *  that keeps a media cell at its natural aspect ratio. */
  fullWidthPx?: number;
}

// Rows needed so a full-width media cell keeps the media's aspect ratio. Adds
// a row of headroom per chrome element (header when titled, caption when a
// figure text is set) since those sit outside the image's own height. Returns
// null when we lack the aspect or the measured width (fall back to the caller's
// default sizing).
function mediaRows(
  w: SocialDashboardWidget,
  { mediaAspect, fullWidthPx }: CompactLayoutOptions,
): number | null {
  const aspect = mediaAspect?.[w.i];
  if (!aspect || aspect <= 0 || !fullWidthPx || fullWidthPx <= 0) return null;
  const imageHeightPx = fullWidthPx / aspect;
  let rows = Math.round((imageHeightPx + MARGIN_Y_PX) / (ROW_HEIGHT_PX + MARGIN_Y_PX));
  if (w.title) rows += 1; // header strip
  if (w.figureText) rows += 1; // figure caption
  return Math.min(16, Math.max(2, rows));
}

// Builds a small-breakpoint layout that preserves the designer's visual order.
// Walks widgets in (y, x) order: consecutive number-cards sharing a designed
// row stay side-by-side (wrapping to extra rows on very narrow viewports);
// everything else stacks full-width.
export function buildCompactLayout(
  widgets: SocialDashboardWidget[],
  cols: number,
  options: CompactLayoutOptions = {},
): LayoutItem[] {
  const sorted = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  const layout: LayoutItem[] = [];
  let y = 0;
  let i = 0;
  while (i < sorted.length) {
    const w = sorted[i];
    if (w.chartType === 'number-card') {
      const rowY = w.y;
      const rowCards: SocialDashboardWidget[] = [];
      while (
        i < sorted.length &&
        sorted[i].chartType === 'number-card' &&
        sorted[i].y === rowY
      ) {
        rowCards.push(sorted[i]);
        i++;
      }
      const cardsPerRow = Math.max(1, Math.floor(cols / MIN_KPI_W));
      const cardsThisRun = Math.min(rowCards.length, cardsPerRow);
      const cardW = Math.max(1, Math.floor(cols / cardsThisRun));
      let col = 0;
      let rowOffset = 0;
      rowCards.forEach((c) => {
        if (col + cardW > cols) {
          rowOffset += 2;
          col = 0;
        }
        layout.push({ i: c.i, x: col, y: y + rowOffset, w: cardW, h: 2 });
        col += cardW;
      });
      y += rowOffset + 2;
    } else {
      let h: number;
      if (w.aggregation === 'media') {
        // Size the cell to the media's own aspect ratio so a wide banner isn't
        // cropped into a near-square box on a narrow viewport. Falls back to
        // the desktop height (min 2) until the aspect ratio is measured.
        h = mediaRows(w, options) ?? Math.max(w.h, 2);
      } else {
        // Text cards auto-fit their height to content and can legitimately be a
        // single row (a one-line title). Flooring them to the 4-row chart
        // minimum leaves a big empty gap below them on mobile, so preserve their
        // own h.
        const minH = w.aggregation === 'text' ? 1 : 4;
        h = Math.max(w.h, minH);
      }
      layout.push({ i: w.i, x: 0, y, w: cols, h });
      y += h;
      i++;
    }
  }
  return layout;
}
