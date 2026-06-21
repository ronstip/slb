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

// Picker options shown to the user. Values are interpreted as the user's
// LOCAL time. They are converted to UTC before being stored, and converted
// back to local for display.
export const SCHEDULE_LOCAL_TIMES = [
  { label: '12:00 AM', value: '00:00' },
  { label: '02:00 AM', value: '02:00' },
  { label: '04:00 AM', value: '04:00' },
  { label: '06:00 AM', value: '06:00' },
  { label: '08:00 AM', value: '08:00' },
  { label: '09:00 AM', value: '09:00' },
  { label: '10:00 AM', value: '10:00' },
  { label: '12:00 PM', value: '12:00' },
  { label: '02:00 PM', value: '14:00' },
  { label: '04:00 PM', value: '16:00' },
  { label: '06:00 PM', value: '18:00' },
  { label: '09:00 PM', value: '21:00' },
] as const;

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
  time: string; // only meaningful for 'day' unit; stored as UTC
}

/** Parse a schedule string → { unit, interval, time }. `time` is UTC "HH:MM". */
export function parseScheduleString(schedule?: string | null): ParsedSchedule {
  if (!schedule || schedule === 'daily') return { unit: 'day', interval: 1, time: '09:00' };
  if (schedule === 'weekly') return { unit: 'day', interval: 7, time: '09:00' };
  const mm = schedule.match(/^(\d+)m$/);
  if (mm) return { unit: 'minute', interval: parseInt(mm[1], 10), time: '09:00' };
  const hm = schedule.match(/^(\d+)h$/);
  if (hm) return { unit: 'hour', interval: parseInt(hm[1], 10), time: '09:00' };
  const dm = schedule.match(/^(\d+)d@(\d{2}:\d{2})$/);
  if (dm) return { unit: 'day', interval: parseInt(dm[1], 10), time: dm[2] };
  return { unit: 'day', interval: 1, time: '09:00' };
}

/** Build a schedule string from parts. `localTime` is local "HH:MM"; storage uses UTC. */
export function buildScheduleString(unit: ScheduleUnit, interval: number, localTime: string): string {
  if (unit === 'minute') return `${interval}m`;
  if (unit === 'hour') return `${interval}h`;
  return `${interval}d@${localTimeToUtc(localTime)}`;
}

/** Format a schedule into human-readable text (in the viewer's local time). */
export function formatSchedule(schedule?: string | null): string {
  const { unit, interval, time } = parseScheduleString(schedule);
  if (unit === 'minute') return `Every ${interval === 1 ? 'minute' : `${interval} minutes`}`;
  if (unit === 'hour') return `Every ${interval === 1 ? 'hour' : `${interval} hours`}`;
  const local = utcTimeToLocal(time);
  const tz = getLocalTzAbbrev();
  const suffix = tz ? ` ${tz}` : '';
  if (interval === 7) return `Every week at ${formatTime12(local)}${suffix}`;
  return `Every ${interval === 1 ? 'day' : `${interval} days`} at ${formatTime12(local)}${suffix}`;
}

/** Compute the next run time for a schedule string, mirroring the backend
 *  `workers/pipeline/schedule_utils.compute_next_run_at`. All hour/day math is
 *  done in UTC (the backend's clock) so the returned Date — rendered in the
 *  viewer's local zone — matches what the scheduler will actually do.
 *  Hour schedules align to the top of the hour; day/week schedules land on the
 *  stored UTC time, at least one interval ahead of `from`. */
export function computeNextRunAt(frequency?: string | null, from: Date = new Date()): Date | null {
  if (!frequency) return null;
  const { unit, interval, time } = parseScheduleString(frequency);
  const d = new Date(from);
  if (unit === 'minute') {
    d.setMinutes(d.getMinutes() + interval, 0, 0);
    return d;
  }
  if (unit === 'hour') {
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + interval);
    return d;
  }
  // day / week: `time` is stored UTC "HH:MM"
  const [hh, mm] = time.split(':').map(Number);
  d.setUTCHours(hh, mm, 0, 0);
  d.setUTCDate(d.getUTCDate() + interval);
  while (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
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

export type SchedulePreset = 'hourly' | 'daily' | 'weekly';

/** Build a schedule string from a preset frequency. `localTime` is local "HH:MM". */
export function buildScheduleFromPreset(preset: SchedulePreset, localTime: string): string {
  if (preset === 'hourly') return '1h';
  const utc = localTimeToUtc(localTime);
  if (preset === 'daily') return `1d@${utc}`;
  return `7d@${utc}`; // weekly
}

/** Reverse-map a schedule string to a preset + local "HH:MM". */
export function parseToPreset(schedule?: string | null): { preset: SchedulePreset; time: string } {
  const parsed = parseScheduleString(schedule);
  if (parsed.unit === 'hour' || parsed.unit === 'minute')
    return { preset: 'hourly', time: '09:00' };
  const local = utcTimeToLocal(parsed.time);
  if (parsed.interval >= 7) return { preset: 'weekly', time: local };
  return { preset: 'daily', time: local };
}
