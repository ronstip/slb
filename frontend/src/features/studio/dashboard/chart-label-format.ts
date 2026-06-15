import type { SocialChartType, TableColumnDisplay } from './types-social-dashboard.ts';

/** Effective value-label format for a chart given the user's choice. Unset
 *  preserves each chart's historical default: pie/doughnut show percent (in the
 *  legend), every other numeric chart shows the absolute number. */
export function resolveLabelDisplay(
  chartType: SocialChartType,
  labelDisplay: TableColumnDisplay | undefined,
): TableColumnDisplay {
  if (labelDisplay) return labelDisplay;
  return chartType === 'pie' || chartType === 'doughnut' ? 'pct' : 'abs';
}

/** Percent of `total`, kept compact: 1dp under 10%, none above. Guards a zero /
 *  non-finite total (returns '0%') so an empty chart never renders NaN. */
export function formatPct(value: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%';
  const p = (value / total) * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/** Compose a value label from its already-formatted absolute text and the
 *  chosen display. `value`/`total` drive the percent (share of total shown).
 *  Caller supplies `absText` so the chart keeps its own number formatting. */
export function composeLabel(
  absText: string,
  value: number,
  total: number,
  display: TableColumnDisplay,
): string {
  if (display === 'pct') return formatPct(value, total);
  if (display === 'abs_pct') return `${absText} (${formatPct(value, total)})`;
  return absText;
}
