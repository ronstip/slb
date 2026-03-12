import type { ReactNode } from 'react';
import type { ColumnDef } from './DataTable.tsx';
import {
  ExternalLinkCell,
  PlatformCell,
  HandleCell,
  SentimentBadge,
  ThemeChips,
  EntityChips,
  EngagementCell,
  TimeAgoCell,
  ContentPreview,
  parseStringList,
} from './cells.tsx';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';

/* ------------------------------------------------------------------ */
/* Post Columns (11 cols)                                              */
/* Used by PostDataTable and TableModal                                */
/* ------------------------------------------------------------------ */

interface PostColumnRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title?: string | null;
  content?: string | null;
  post_url: string;
  posted_at: string;
  likes?: number | null;
  views?: number | null;
  comments_count?: number | null;
  sentiment?: string | null;
  themes?: string | string[] | null;
  entities?: string | string[] | null;
  ai_summary?: string | null;
}

interface PostColumnsOptions<T> {
  /** Column header label for the summary/content column */
  summaryLabel?: string;
  /** Which field to use: 'ai_summary' (default) or 'content' */
  summaryField?: 'ai_summary' | 'content';
  /** Show entities column (default true) */
  showEntities?: boolean;
  /** Render function for HoverCard content on external link */
  hoverContent?: (row: T) => ReactNode;
}

export function postColumns<T extends PostColumnRow>(
  opts: PostColumnsOptions<T> = {},
): ColumnDef<T>[] {
  const {
    summaryLabel = 'AI Summary',
    summaryField = 'ai_summary',
    showEntities = true,
    hoverContent,
  } = opts;

  const cols: ColumnDef<T>[] = [
    {
      key: 'link',
      header: '',
      width: 'w-8',
      render: (row) => (
        <ExternalLinkCell
          url={row.post_url}
          hoverContent={hoverContent?.(row)}
        />
      ),
    },
    {
      key: 'platform',
      header: 'Platform',
      width: 'w-[8%]',
      render: (row) => <PlatformCell platform={row.platform} />,
    },
    {
      key: 'handle',
      header: 'Handle',
      width: 'w-[10%]',
      render: (row) => <HandleCell handle={row.channel_handle} />,
    },
    {
      key: 'summary',
      header: summaryLabel,
      render: (row) => {
        const text = summaryField === 'content'
          ? [row.title, row.content].filter(Boolean).join(' ')
          : row.ai_summary || [row.title, row.content].filter(Boolean).join(' ');
        return <ContentPreview text={text} />;
      },
    },
    {
      key: 'posted_at',
      header: 'Posted',
      width: 'w-[7%]',
      sortable: true,
      render: (row) => <TimeAgoCell date={row.posted_at} />,
    },
    {
      key: 'likes',
      header: 'Likes',
      width: 'w-[6%]',
      align: 'right',
      sortable: true,
      render: (row) => <EngagementCell value={row.likes} />,
    },
    {
      key: 'views',
      header: 'Views',
      width: 'w-[6%]',
      align: 'right',
      sortable: true,
      render: (row) => <EngagementCell value={row.views} />,
    },
    {
      key: 'comments_count',
      header: 'Comments',
      width: 'w-[7%]',
      align: 'right',
      sortable: true,
      render: (row) => <EngagementCell value={row.comments_count} />,
    },
    {
      key: 'sentiment',
      header: 'Sentiment',
      width: 'w-[8%]',
      render: (row) => <SentimentBadge sentiment={row.sentiment} />,
    },
    {
      key: 'themes',
      header: 'Themes',
      width: 'w-[12%]',
      render: (row) => <ThemeChips themes={parseStringList(row.themes)} />,
    },
  ];

  if (showEntities) {
    cols.push({
      key: 'entities',
      header: 'Entities',
      width: 'w-[12%]',
      render: (row) => <EntityChips entities={parseStringList(row.entities)} />,
    });
  }

  return cols;
}

/* ------------------------------------------------------------------ */
/* Top Posts Columns (6 cols)                                           */
/* Used by TopPostsTable in report cards                               */
/* ------------------------------------------------------------------ */

interface TopPostRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title: string;
  post_url: string;
  likes: number;
  views: number;
  shares: number;
  comments_count: number;
}

export function topPostColumns<T extends TopPostRow>(): ColumnDef<T>[] {
  return [
    {
      key: 'link',
      header: '',
      width: 'w-8',
      render: (row) =>
        row.post_url ? (
          <ExternalLinkCell url={row.post_url} />
        ) : null,
    },
    {
      key: 'post',
      header: 'Post',
      render: (row) => {
        const platformLabel = PLATFORM_LABELS[row.platform?.toLowerCase()] ?? row.platform;
        return (
          <div className="max-w-[300px]">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{platformLabel}</span>
              <span>·</span>
              <span>@{row.channel_handle}</span>
            </div>
            {row.title && (
              <p className="line-clamp-1 text-[12px] leading-tight text-foreground">
                {row.title}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'views',
      header: 'Views',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums text-foreground">
          {row.views > 0 ? formatNumber(row.views) : '—'}
        </span>
      ),
    },
    {
      key: 'likes',
      header: 'Likes',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums text-foreground">
          {row.likes > 0 ? formatNumber(row.likes) : '—'}
        </span>
      ),
    },
    {
      key: 'comments_count',
      header: 'Comments',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums text-foreground">
          {row.comments_count > 0 ? formatNumber(row.comments_count) : '—'}
        </span>
      ),
    },
    {
      key: 'shares',
      header: 'Shares',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums text-foreground">
          {row.shares > 0 ? formatNumber(row.shares) : '—'}
        </span>
      ),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Preview Columns (5 cols)                                            */
/* Used by DataExportCard mini preview table                           */
/* ------------------------------------------------------------------ */

interface PreviewRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title?: string | null;
  content?: string | null;
  ai_summary?: string | null;
  views: number | null | undefined;
  sentiment?: string | null;
}

export function previewColumns<T extends PreviewRow>(): ColumnDef<T>[] {
  return [
    {
      key: 'platform',
      header: 'Platform',
      render: (row) => <PlatformCell platform={row.platform} />,
    },
    {
      key: 'handle',
      header: 'Handle',
      render: (row) => <HandleCell handle={row.channel_handle} />,
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => {
        const text = row.ai_summary?.slice(0, 60) || [row.title, row.content].filter(Boolean).join(' ').slice(0, 60);
        return (
          <span className="max-w-[200px] truncate text-foreground/80">
            {text || '—'}
          </span>
        );
      },
    },
    {
      key: 'views',
      header: 'Views',
      align: 'right',
      render: (row) => <EngagementCell value={row.views} />,
    },
    {
      key: 'sentiment',
      header: 'Sentiment',
      render: (row) => <SentimentBadge sentiment={row.sentiment} />,
    },
  ];
}
