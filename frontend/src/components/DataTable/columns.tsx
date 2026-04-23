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
