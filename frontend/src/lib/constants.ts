export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web',
  google_search_agent: 'Searching the web',
  design_research: 'Designing research plan',
  start_collection: 'Starting data collection',
  get_progress: 'Checking collection progress',
  get_insights: 'Generating insight report',
  enrich_collection: 'Running AI enrichment',
  refresh_engagements: 'Refreshing engagement metrics',
  cancel_collection: 'Cancelling collection',
  export_data: 'Preparing data export',
  execute_sql: 'Querying data',
  create_chart: 'Creating chart',
  get_table_info: 'Inspecting table schema',
  list_table_ids: 'Discovering tables',
  display_posts: 'Preparing post display',
};

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  research_agent: 'Understanding',
  collection_agent: 'Collecting',
  analyst_agent: 'Analyzing',
};

export const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#A8677A',
  tiktok: '#57534E',
  twitter: '#6A9AB8',
  reddit: '#B87845',
  youtube: '#B85C5C',
};

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  reddit: 'Reddit',
  youtube: 'YouTube',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#5A9E7E',
  negative: '#C07070',
  neutral: '#8E8E93',
  mixed: '#B89A5A',
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
