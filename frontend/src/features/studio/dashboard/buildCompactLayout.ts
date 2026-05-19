import type { LayoutItem } from 'react-grid-layout';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

// Builds a small-breakpoint layout that preserves the designer's visual order.
// Walks widgets in (y, x) order: consecutive number-cards sharing a designed
// row stay side-by-side; everything else stacks full-width.
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
      const cardW = Math.max(1, Math.floor(cols / rowCards.length));
      rowCards.forEach((c, idx) => {
        layout.push({ i: c.i, x: idx * cardW, y, w: cardW, h: 2 });
      });
      y += 2;
    } else {
      layout.push({ i: w.i, x: 0, y, w: cols, h: Math.max(w.h, 4) });
      y += Math.max(w.h, 4);
      i++;
    }
  }
  return layout;
}
