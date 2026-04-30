export type ToolCategory = 'thinking' | 'tools' | 'outputs';

export const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // Thinking — research, lookup, status
  google_search: 'thinking',
  google_search_agent: 'thinking',
  design_research: 'thinking',
  get_collection_details: 'thinking',
  get_table_info: 'thinking',
  list_table_ids: 'thinking',
  get_agent_status: 'thinking',
  set_active_agent: 'thinking',
  ask_user: 'thinking',
  // Tools — execution, processing
  execute_sql: 'tools',
  start_agent: 'tools',
  // Outputs — deliverables
  create_chart: 'outputs',
  generate_dashboard: 'outputs',
  compose_dashboard: 'outputs',
  generate_presentation: 'outputs',
  export_data: 'outputs',
  compose_email: 'outputs',
};

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web',
  google_search_agent: 'Searching the web',
  design_research: 'Designing research plan',
  get_collection_details: 'Loading collection details',
  export_data: 'Preparing data export',
  execute_sql: 'Querying data',
  create_chart: 'Creating chart',
  get_table_info: 'Inspecting table schema',
  list_table_ids: 'Discovering tables',
  generate_dashboard: 'Creating interactive dashboard',
  compose_dashboard: 'Composing custom dashboard',
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
  positive: '#5FB88A',
  negative: '#C75A62',
  neutral: '#94999F',
  mixed: '#D4A054',
  // Stance / reception variants — kept distinct in hue (not just value) so
  // adjacent segments in a stacked bar remain readable. supportive=green,
  // opposed=red, skeptical=amber matches the positive/negative/mixed mapping
  // used elsewhere.
  supportive: '#5FB88A',
  opposed: '#C75A62',
  skeptical: '#D4A054',
};

export const PLATFORMS = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SCHEDULE_UTC_TIMES = [
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

export type ScheduleUnit = 'minute' | 'hour' | 'day';

export interface ParsedSchedule {
  unit: ScheduleUnit;
  interval: number;
  time: string; // only meaningful for 'day' unit
}

/** Parse a schedule string → { unit, interval, time } */
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

/** Build a schedule string from parts */
export function buildScheduleString(unit: ScheduleUnit, interval: number, time: string): string {
  if (unit === 'minute') return `${interval}m`;
  if (unit === 'hour') return `${interval}h`;
  return `${interval}d@${time}`;
}

/** Format a schedule into human-readable text */
export function formatSchedule(schedule?: string | null): string {
  const { unit, interval, time } = parseScheduleString(schedule);
  if (unit === 'minute') return `Every ${interval === 1 ? 'minute' : `${interval} minutes`}`;
  if (unit === 'hour') return `Every ${interval === 1 ? 'hour' : `${interval} hours`}`;
  if (interval === 7) return `Every week at ${time} UTC`;
  return `Every ${interval === 1 ? 'day' : `${interval} days`} at ${time} UTC`;
}

export type SchedulePreset = 'hourly' | 'daily' | 'weekly';

/** Build a schedule string from a preset frequency */
export function buildScheduleFromPreset(preset: SchedulePreset, time: string): string {
  if (preset === 'hourly') return '1h';
  if (preset === 'daily') return `1d@${time}`;
  return `7d@${time}`; // weekly
}

/** Reverse-map a schedule string to a preset + time */
export function parseToPreset(schedule?: string | null): { preset: SchedulePreset; time: string } {
  const parsed = parseScheduleString(schedule);
  if (parsed.unit === 'hour' || parsed.unit === 'minute')
    return { preset: 'hourly', time: '09:00' };
  if (parsed.interval >= 7)
    return { preset: 'weekly', time: parsed.time };
  return { preset: 'daily', time: parsed.time };
}
