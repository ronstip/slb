import type { LayoutItem } from 'react-grid-layout';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

// Below this card width the KPI value gets truncated on mobile, so we wrap
// the designed row across additional rows instead of cramming.
const MIN_KPI_W = 2;

// Builds a small-breakpoint layout that preserves the designer's visual order.
// Walks widgets in (y, x) order: consecutive number-cards sharing a designed
// row stay side-by-side (wrapping to extra rows on very narrow viewports);
// everything else stacks full-width.
export function buildCompactLayout(
  widgets: SocialDashboardWidget[],
  cols: number,
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
      layout.push({ i: w.i, x: 0, y, w: cols, h: Math.max(w.h, 4) });
      y += Math.max(w.h, 4);
      i++;
    }
  }
  return layout;
}
