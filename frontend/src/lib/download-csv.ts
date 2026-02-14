/**
 * CSV column configuration.
 * Maps BQ column names to human-readable CSV headers.
 * Order here determines column order in the exported file.
 * When the schema evolves, update this array.
 */
export const CSV_COLUMNS: Array<{ key: string; header: string }> = [
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

function escapeCsvValue(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  const headers = CSV_COLUMNS.map((c) => c.header);
  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = CSV_COLUMNS.map((c) => escapeCsvValue(row[c.key]));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function downloadCsv(rows: Record<string, unknown>[], filename = 'data-export'): void {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
