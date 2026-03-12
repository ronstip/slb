export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web',
  google_search_agent: 'Searching the web',
  design_research: 'Designing research plan',
  get_progress: 'Checking collection progress',
  get_collection_details: 'Loading collection details',
  enrich_collection: 'Running AI enrichment',
  refresh_engagements: 'Refreshing engagement metrics',
  cancel_collection: 'Cancelling collection',
  export_data: 'Preparing data export',
  execute_sql: 'Querying data',
  create_chart: 'Creating chart',
  get_table_info: 'Inspecting table schema',
  list_table_ids: 'Discovering tables',
  generate_report: 'Generating insight report',
  generate_dashboard: 'Creating interactive dashboard',
  ask_user: 'Preparing questions',
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
};

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  reddit: 'Reddit',
  youtube: 'YouTube',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#22C55E',
  negative: '#EF4444',
  neutral: '#94A3B8',
  mixed: '#F59E0B',
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

/** Parse a schedule string ("daily", "weekly", or "Nd@HH:MM") → { days, time } */
export function parseScheduleString(schedule?: string | null): { days: number; time: string } {
  if (!schedule || schedule === 'daily') return { days: 1, time: '09:00' };
  if (schedule === 'weekly') return { days: 7, time: '09:00' };
  const m = schedule.match(/^(\d+)d@(\d{2}:\d{2})$/);
  if (m) return { days: parseInt(m[1], 10), time: m[2] };
  return { days: 1, time: '09:00' };
}

/** Format a schedule into human-readable text e.g. "Every day at 09:00 UTC" */
export function formatSchedule(schedule?: string | null): string {
  const { days, time } = parseScheduleString(schedule);
  return `Every ${days === 1 ? 'day' : `${days} days`} at ${time} UTC`;
}
