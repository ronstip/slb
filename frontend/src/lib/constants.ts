export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web',
  design_research: 'Designing research plan',
  start_collection: 'Starting data collection',
  get_progress: 'Checking collection progress',
  get_insights: 'Generating insight report',
  enrich_collection: 'Running AI enrichment',
  refresh_engagements: 'Refreshing engagement metrics',
  cancel_collection: 'Cancelling collection',
  export_data: 'Preparing data export',
  execute_sql: 'Querying data',
  get_table_info: 'Inspecting table schema',
  list_table_ids: 'Discovering tables',
};

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  orchestrator: 'Routing',
  research_agent: 'Research',
  collection_agent: 'Collection',
  analyst_agent: 'Analyst',
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
