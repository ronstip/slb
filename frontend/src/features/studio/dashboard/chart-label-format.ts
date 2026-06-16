import { format } from 'date-fns';
import type { SocialChartType, TableColumnDisplay } from './types-social-dashboard.ts';

// The ISO bucket keys `bucketDate` emits become category-axis labels on bar
// charts: hour → "YYYY-MM-DDTHH:00:00", day/week → "YYYY-MM-DD", month →
// "YYYY-MM". Parsed from parts into a LOCAL Date (never `new Date(iso)`, which
// treats a bare date as UTC and drifts a day in negative timezones).
const BUCKET_HOUR_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}:\d{2}$/;
const BUCKET_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BUCKET_MONTH_RE = /^(\d{4})-(\d{2})$/;

/** Format a bucket-date category label into a compact human label, matching the
 *  line charts' time-axis display formats (`MMM d`, `MMM yyyy`, `MMM d, HH:mm`).
 *  Returns the input unchanged when it isn't a recognized bucket-date shape, so
 *  it's safe to apply to any category label (non-date categories pass through). */
export function formatBucketLabel(label: string): string {
  let m = BUCKET_HOUR_RE.exec(label);
  if (m) return format(new Date(+m[1], +m[2] - 1, +m[3], +m[4]), 'MMM d, HH:mm');
  m = BUCKET_DAY_RE.exec(label);
  if (m) return format(new Date(+m[1], +m[2] - 1, +m[3]), 'MMM d');
  m = BUCKET_MONTH_RE.exec(label);
  if (m) return format(new Date(+m[1], +m[2] - 1, 1), 'MMM yyyy');
  return label;
}

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
  if (display === 'none') return '';
  if (display === 'pct') return formatPct(value, total);
  if (display === 'abs_pct') return `${absText} (${formatPct(value, total)})`;
  return absText;
}
