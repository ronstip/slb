export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  google_search: 'Searching the web...',
  design_research: 'Designing research plan...',
  start_collection: 'Starting data collection...',
  get_progress: 'Checking progress...',
  get_insights: 'Analyzing collected data...',
  enrich_collection: 'Enriching posts...',
  refresh_engagements: 'Refreshing engagement data...',
  cancel_collection: 'Cancelling collection...',
};

export const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E4405F',
  tiktok: '#1C1917',
  twitter: '#1DA1F2',
  reddit: '#FF4500',
  youtube: '#FF0000',
};

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  reddit: 'Reddit',
  youtube: 'YouTube',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#059669',
  negative: '#DC2626',
  neutral: '#78716C',
  mixed: '#D97706',
};

export const PLATFORMS = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];
