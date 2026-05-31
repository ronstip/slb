// Shared date-range helpers used by both the top-bar DateTimeRangeFilter and
// the per-column DateRangeFilterHeader, so the two can't drift apart.

export interface DateTimeRange {
  from: string | null;
  to: string | null;
}

export const DATE_PRESETS: { label: string; ms: number }[] = [
  { label: 'Last 1h', ms: 60 * 60 * 1000 },
  { label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last 30d', ms: 30 * 24 * 60 * 60 * 1000 },
];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatShort(iso: string | null): string {
  if (!iso) return '…';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** When the range is an open-ended "last N" window, return its preset label. */
export function matchPresetLabel(value: DateTimeRange): string | null {
  if (!value.from || value.to) return null;
  const fromMs = new Date(value.from).getTime();
  const delta = Date.now() - fromMs;
  const tolerance = 60 * 1000;
  const hit = DATE_PRESETS.find((p) => Math.abs(delta - p.ms) < tolerance);
  return hit ? hit.label : null;
}
