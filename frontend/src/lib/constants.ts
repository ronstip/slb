export type ToolCategory = 'thinking' | 'tools' | 'outputs';

export const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // Thinking - research, lookup, status
  google_search: 'thinking',
  google_search_agent: 'thinking',
  design_research: 'thinking',
  get_table_info: 'thinking',
  list_table_ids: 'thinking',
  get_agent_status: 'thinking',
  set_active_agent: 'thinking',
  ask_user: 'thinking',
  // Tools - execution, processing
  execute_sql: 'tools',
  start_agent: 'tools',
  // Outputs - deliverables
  create_chart: 'outputs',
  generate_presentation: 'outputs',
  export_data: 'outputs',
  compose_email: 'outputs',
};

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web',
  google_search_agent: 'Searching the web',
  design_research: 'Designing research plan',
  export_data: 'Preparing data export',
  execute_sql: 'Querying data',
  create_chart: 'Creating chart',
  get_table_info: 'Inspecting table schema',
  list_table_ids: 'Discovering tables',
  generate_presentation: 'Building presentation deck',
  ask_user: 'Preparing questions',
  start_agent: 'Starting agent',
  get_agent_status: 'Checking agent status',
  set_active_agent: 'Loading agent context',
};

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  meta_agent: '',
};

export const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#C13584',
  tiktok: '#57534E',
  twitter: '#1DA1F2',
  reddit: '#E05A00',
  youtube: '#E03030',
  facebook: '#1877F2',
  google_search: '#4285F4',
  web: '#4285F4',
};

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  reddit: 'Reddit',
  youtube: 'YouTube',
  facebook: 'Facebook',
  google_search: 'Web',
  web: 'Web',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  // Editorial palette - warm-toned, brand-tuned. Tracks the Claude Design
  // sentiment family so widgets, donut charts, and the channel-mix stacked
  // bar stay consistent with the rest of the cream/ink/terracotta surface.
  positive: '#2F8E6C',
  negative: '#C25E3F',
  neutral: '#8A8275',
  mixed: '#B6843A',
  confused: '#B6843A',
  sarcastic: '#7B5BD9',
  // Stance / reception variants - kept distinct in hue (not just value) so
  // adjacent segments in a stacked bar remain readable. supportive=green,
  // opposed=terracotta, skeptical=amber matches the positive/negative/mixed
  // mapping used elsewhere.
  supportive: '#2F8E6C',
  opposed: '#C25E3F',
  skeptical: '#B6843A',
};

export const PLATFORMS = ['instagram', 'tiktok', 'facebook', 'twitter', 'reddit', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

// Picker options shown to the user — every hour, on the hour. Values are
// interpreted as the user's LOCAL time, converted to UTC before being stored,
// and converted back to local for display.
export const SCHEDULE_LOCAL_TIMES = Array.from({ length: 24 }, (_, h) => {
  const value = `${String(h).padStart(2, '0')}:00`;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { label: `${String(hour12).padStart(2, '0')}:00 ${period}`, value };
});

/** Convert local "HH:MM" (browser's TZ) to UTC "HH:MM". */
export function localTimeToUtc(local: string): string {
  const [h, m] = local.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Convert UTC "HH:MM" to local "HH:MM" (browser's TZ). */
export function utcTimeToLocal(utc: string): string {
  const [h, m] = utc.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Format a "HH:MM" 24h time as 12h ("3:00 AM"). */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Browser-local timezone short name (e.g. "IDT", "PDT"), best-effort. */
export function getLocalTzAbbrev(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export type ScheduleUnit = 'minute' | 'hour' | 'day';

export interface ParsedSchedule {
  unit: ScheduleUnit;
  interval: number;
  time: string; // first slot; only meaningful for 'day' unit; stored as UTC
  times: string[]; // all slots (≥1 for 'day'); UTC "HH:MM", sorted ascending
}

// A day schedule carries one or more UTC clock times: "1d@09:00" (daily) or
// "1d@09:00,21:00" (twice a day). Mirrors the backend `_DAY_RE`.
const DAY_RE = /^(\d+)d@(\d{2}:\d{2}(?:,\d{2}:\d{2})*)$/;

/** Parse a schedule string → { unit, interval, time, times }. Times are UTC "HH:MM". */
export function parseScheduleString(schedule?: string | null): ParsedSchedule {
  if (!schedule || schedule === 'daily') return { unit: 'day', interval: 1, time: '09:00', times: ['09:00'] };
  if (schedule === 'weekly') return { unit: 'day', interval: 7, time: '09:00', times: ['09:00'] };
  const mm = schedule.match(/^(\d+)m$/);
  if (mm) return { unit: 'minute', interval: parseInt(mm[1], 10), time: '09:00', times: ['09:00'] };
  const hm = schedule.match(/^(\d+)h$/);
  if (hm) return { unit: 'hour', interval: parseInt(hm[1], 10), time: '09:00', times: ['09:00'] };
  const dm = schedule.match(DAY_RE);
  if (dm) {
    const times = dm[2].split(',').sort();
    return { unit: 'day', interval: parseInt(dm[1], 10), time: times[0], times };
  }
  return { unit: 'day', interval: 1, time: '09:00', times: ['09:00'] };
}

/** Build a schedule string from parts. `localTime` is local "HH:MM"; storage uses UTC. */
export function buildScheduleString(unit: ScheduleUnit, interval: number, localTime: string): string {
  if (unit === 'minute') return `${interval}m`;
  if (unit === 'hour') return `${interval}h`;
  return `${interval}d@${localTimeToUtc(localTime)}`;
}

/** Format a schedule into human-readable text (in the viewer's local time). */
export function formatSchedule(schedule?: string | null): string {
  const { unit, interval, times } = parseScheduleString(schedule);
  if (unit === 'minute') return `Every ${interval === 1 ? 'minute' : `${interval} minutes`}`;
  if (unit === 'hour') return `Every ${interval === 1 ? 'hour' : `${interval} hours`}`;
  const tz = getLocalTzAbbrev();
  const suffix = tz ? ` ${tz}` : '';
  const local = times.map((t) => formatTime12(utcTimeToLocal(t)));
  if (times.length > 1) {
    // "Twice a day at 9:00 AM and 9:00 PM IDT" (or "at A, B and C" for more).
    const list = local.length === 2 ? local.join(' and ') : `${local.slice(0, -1).join(', ')} and ${local[local.length - 1]}`;
    return `${times.length === 2 ? 'Twice a day' : `${times.length}× a day`} at ${list}${suffix}`;
  }
  if (interval === 7) return `Every week at ${local[0]}${suffix}`;
  return `Every ${interval === 1 ? 'day' : `${interval} days`} at ${local[0]}${suffix}`;
}

/** Compute the next run time for a schedule string, mirroring the backend
 *  `workers/pipeline/schedule_utils.compute_next_run_at`. All hour/day math is
 *  done in UTC (the backend's clock) so the returned Date — rendered in the
 *  viewer's local zone — matches what the scheduler will actually do.
 *  Hour schedules align to the top of the hour; day/week schedules land on the
 *  stored UTC time, at least one interval ahead of `from`. */
export function computeNextRunAt(frequency?: string | null, from: Date = new Date()): Date | null {
  if (!frequency) return null;
  const { unit, interval, times } = parseScheduleString(frequency);
  if (unit === 'minute') {
    const d = new Date(from);
    d.setMinutes(d.getMinutes() + interval, 0, 0);
    return d;
  }
  if (unit === 'hour') {
    const d = new Date(from);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + interval);
    return d;
  }
  // day / week: each slot is a stored UTC "HH:MM"; take the soonest future one.
  const multi = times.length > 1;
  const candidates = times.map((time) => {
    const [hh, mm] = time.split(':').map(Number);
    const d = new Date(from);
    d.setUTCHours(hh, mm, 0, 0);
    if (multi) {
      // Twice-a-day: soonest future slot, no forced full-day skip.
      while (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + interval);
    } else {
      // Single-time daily/weekly: always at least one interval ahead.
      d.setUTCDate(d.getUTCDate() + interval);
      while (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    }
    return d;
  });
  return candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/** Human-readable absolute time for a next-run indicator, in the viewer's local
 *  zone (e.g. "Sun, Jun 21, 3:00 PM IDT"). Accepts an ISO string or Date. */
export function formatNextRun(when?: string | Date | null): string | null {
  if (!when) return null;
  const d = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(d.getTime())) return null;
  const text = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
  const tz = getLocalTzAbbrev();
  return tz ? `${text} ${tz}` : text;
}

export type SchedulePreset = 'hourly' | 'daily' | 'twice-daily' | 'weekly';

/** Build a schedule string from a preset. `localTimes` are local "HH:MM" — a
 *  single value for hourly/daily/weekly, or two for twice-daily. */
export function buildScheduleFromPreset(preset: SchedulePreset, localTimes: string | string[]): string {
  if (preset === 'hourly') return '1h';
  const list = Array.isArray(localTimes) ? localTimes : [localTimes];
  const utc = list.map(localTimeToUtc);
  if (preset === 'twice-daily') return `1d@${[...utc].sort().join(',')}`;
  if (preset === 'weekly') return `7d@${utc[0]}`;
  return `1d@${utc[0]}`; // daily
}

/** Reverse-map a schedule string to a preset + local "HH:MM" slots. */
export function parseToPreset(schedule?: string | null): { preset: SchedulePreset; times: string[] } {
  const parsed = parseScheduleString(schedule);
  if (parsed.unit === 'hour' || parsed.unit === 'minute')
    return { preset: 'hourly', times: ['09:00'] };
  const local = parsed.times.map(utcTimeToLocal);
  if (parsed.times.length > 1) return { preset: 'twice-daily', times: local };
  if (parsed.interval >= 7) return { preset: 'weekly', times: local };
  return { preset: 'daily', times: local };
}
