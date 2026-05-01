/**
 * CSV column configuration.
 * Maps row keys to human-readable CSV headers.
 * Order here determines column order in the exported file.
 * When the schema evolves, update this array.
 */
export interface CsvColumn {
  key: string;
  header: string;
}

export const CSV_COLUMNS: CsvColumn[] = [
  { key: 'post_id', header: 'Post ID' },
  { key: 'platform', header: 'Platform' },
  { key: 'channel_handle', header: 'Channel' },
  { key: 'title', header: 'Title' },
  { key: 'content', header: 'Content' },
  { key: 'post_url', header: 'URL' },
  { key: 'posted_at', header: 'Posted At' },
  { key: 'post_type', header: 'Post Type' },
  { key: 'likes', header: 'Likes' },
  { key: 'shares', header: 'Shares' },
  { key: 'views', header: 'Views' },
  { key: 'comments_count', header: 'Comments' },
  { key: 'saves', header: 'Saves' },
  { key: 'total_engagement', header: 'Total Engagement' },
  { key: 'sentiment', header: 'Sentiment' },
  { key: 'themes', header: 'Themes' },
  { key: 'entities', header: 'Entities' },
  { key: 'ai_summary', header: 'AI Summary' },
  { key: 'content_type', header: 'Content Type' },
];

/**
 * FeedPost shape — matches the rows displayed in PostsDataPanel.
 * Headers are snake_case to match BQ field names and pipe cleanly into pandas.
 * `media_refs` is intentionally omitted.
 */
export const FEED_POST_CSV_COLUMNS: CsvColumn[] = [
  { key: 'post_id', header: 'post_id' },
  { key: 'collection_id', header: 'collection_id' },
  { key: 'platform', header: 'platform' },
  { key: 'channel_handle', header: 'channel_handle' },
  { key: 'channel_id', header: 'channel_id' },
  { key: 'channel_type', header: 'channel_type' },
  { key: 'post_type', header: 'post_type' },
  { key: 'posted_at', header: 'posted_at' },
  { key: 'post_url', header: 'post_url' },
  { key: 'title', header: 'title' },
  { key: 'content', header: 'content' },
  { key: 'likes', header: 'likes' },
  { key: 'shares', header: 'shares' },
  { key: 'views', header: 'views' },
  { key: 'comments_count', header: 'comments_count' },
  { key: 'saves', header: 'saves' },
  { key: 'total_engagement', header: 'total_engagement' },
  { key: 'sentiment', header: 'sentiment' },
  { key: 'emotion', header: 'emotion' },
  { key: 'language', header: 'language' },
  { key: 'content_type', header: 'content_type' },
  { key: 'themes', header: 'themes' },
  { key: 'entities', header: 'entities' },
  { key: 'detected_brands', header: 'detected_brands' },
  { key: 'ai_summary', header: 'ai_summary' },
  { key: 'context', header: 'context' },
  { key: 'is_related_to_task', header: 'is_related_to_task' },
  { key: 'custom_fields', header: 'custom_fields' },
  { key: 'is_retweet', header: 'is_retweet' },
  { key: 'is_quote', header: 'is_quote' },
];

function escapeCsvValue(value: unknown): string {
  if (value == null) return '';
  const str = Array.isArray(value) || (typeof value === 'object' && value !== null)
    ? JSON.stringify(value)
    : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(
  rows: readonly object[],
  columns: CsvColumn[] = CSV_COLUMNS,
): string {
  const headers = columns.map((c) => c.header);
  const lines = [headers.join(',')];

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const values = columns.map((c) => escapeCsvValue(r[c.key]));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function downloadCsv(
  rows: readonly object[],
  filename = 'data-export',
  columns: CsvColumn[] = CSV_COLUMNS,
): void {
  const csv = '﻿' + rowsToCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
