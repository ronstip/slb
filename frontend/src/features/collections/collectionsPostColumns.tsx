import type { ColumnDef } from '../../components/DataTable/DataTable.tsx';
import type { FeedPost } from '../../api/types.ts';
import type { FilterOption } from './ColumnFilterHeader.tsx';
import {
  ExternalLinkCell,
  SentimentBadge,
  EntityChips,
  parseStringList,
} from '../../components/DataTable/cells.tsx';
import { PostCard } from '../studio/PostCard.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import { MultiSelectFilterHeader, TextFilterHeader } from './ColumnFilterHeader.tsx';

/* ------------------------------------------------------------------ */
/* Filter state type — all multi-select columns use Set<string>        */
/* ------------------------------------------------------------------ */

export interface ColumnFilters {
  platform: Set<string>;
  sentiment: Set<string>;
  emotion: Set<string>;
  contentType: Set<string>;
  channelType: Set<string>;
  handle: Set<string>;
  themes: Set<string>;
  entities: Set<string>;
  brands: Set<string>;
  content: string; // free-text only for content/summary
}

export function createEmptyFilters(): ColumnFilters {
  return {
    platform: new Set(),
    sentiment: new Set(),
    emotion: new Set(),
    contentType: new Set(),
    channelType: new Set(),
    handle: new Set(),
    themes: new Set(),
    entities: new Set(),
    brands: new Set(),
    content: '',
  };
}

export function hasActiveFilters(f: ColumnFilters): boolean {
  return (
    f.platform.size > 0 ||
    f.sentiment.size > 0 ||
    f.emotion.size > 0 ||
    f.contentType.size > 0 ||
    f.channelType.size > 0 ||
    f.handle.size > 0 ||
    f.themes.size > 0 ||
    f.entities.size > 0 ||
    f.brands.size > 0 ||
    f.content.length > 0
  );
}

export function applyColumnFilters(posts: FeedPost[], filters: ColumnFilters): FeedPost[] {
  let result = posts;

  if (filters.platform.size > 0)
    result = result.filter((p) => filters.platform.has(p.platform));
  if (filters.sentiment.size > 0)
    result = result.filter((p) => p.sentiment && filters.sentiment.has(p.sentiment));
  if (filters.emotion.size > 0)
    result = result.filter((p) => p.emotion && filters.emotion.has(p.emotion));
  if (filters.contentType.size > 0)
    result = result.filter((p) => p.content_type && filters.contentType.has(p.content_type));
  if (filters.channelType.size > 0)
    result = result.filter((p) => p.channel_type && filters.channelType.has(p.channel_type));
  if (filters.handle.size > 0)
    result = result.filter((p) => filters.handle.has(p.channel_handle));
  if (filters.content) {
    const q = filters.content.toLowerCase();
    result = result.filter((p) => {
      const text = [p.title, p.content, p.ai_summary].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }
  if (filters.themes.size > 0)
    result = result.filter((p) => (p.themes ?? []).some((t) => filters.themes.has(t)));
  if (filters.entities.size > 0)
    result = result.filter((p) => (p.entities ?? []).some((e) => filters.entities.has(e)));
  if (filters.brands.size > 0)
    result = result.filter((p) => (p.detected_brands ?? []).some((b) => filters.brands.has(b)));

  return result;
}

/* ------------------------------------------------------------------ */
/* Extract unique values WITH COUNTS for filter dropdowns              */
/* ------------------------------------------------------------------ */

export interface FilterOptionsWithCounts {
  platforms: FilterOption[];
  sentiments: FilterOption[];
  emotions: FilterOption[];
  contentTypes: FilterOption[];
  channelTypes: FilterOption[];
  handles: FilterOption[];
  themes: FilterOption[];
  entities: FilterOption[];
  brands: FilterOption[];
}

export function extractFilterOptions(posts: FeedPost[]): FilterOptionsWithCounts {
  const platforms = new Map<string, number>();
  const sentiments = new Map<string, number>();
  const emotions = new Map<string, number>();
  const contentTypes = new Map<string, number>();
  const channelTypes = new Map<string, number>();
  const handles = new Map<string, number>();
  const themes = new Map<string, number>();
  const entities = new Map<string, number>();
  const brands = new Map<string, number>();

  for (const p of posts) {
    platforms.set(p.platform, (platforms.get(p.platform) ?? 0) + 1);
    if (p.sentiment) sentiments.set(p.sentiment, (sentiments.get(p.sentiment) ?? 0) + 1);
    if (p.emotion) emotions.set(p.emotion, (emotions.get(p.emotion) ?? 0) + 1);
    if (p.content_type) contentTypes.set(p.content_type, (contentTypes.get(p.content_type) ?? 0) + 1);
    if (p.channel_type) channelTypes.set(p.channel_type, (channelTypes.get(p.channel_type) ?? 0) + 1);
    handles.set(p.channel_handle, (handles.get(p.channel_handle) ?? 0) + 1);
    if (p.themes) {
      for (const t of p.themes) {
        themes.set(t, (themes.get(t) ?? 0) + 1);
      }
    }
    if (p.entities) {
      for (const e of p.entities) {
        entities.set(e, (entities.get(e) ?? 0) + 1);
      }
    }
    if (p.detected_brands) {
      for (const b of p.detected_brands) {
        brands.set(b, (brands.get(b) ?? 0) + 1);
      }
    }
  }

  const toSorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

  return {
    platforms: toSorted(platforms),
    sentiments: toSorted(sentiments),
    emotions: toSorted(emotions),
    contentTypes: toSorted(contentTypes),
    channelTypes: toSorted(channelTypes),
    handles: toSorted(handles),
    themes: toSorted(themes),
    entities: toSorted(entities),
    brands: toSorted(brands),
  };
}

/* ------------------------------------------------------------------ */
/* Column builder                                                      */
/* ------------------------------------------------------------------ */

interface CollectionPostColumnsOptions {
  filters: ColumnFilters;
  onFiltersChange: (filters: ColumnFilters) => void;
  filterOptions: FilterOptionsWithCounts;
}

export function collectionsPostColumns(
  opts: CollectionPostColumnsOptions,
): ColumnDef<FeedPost>[] {
  const {
    filters, onFiltersChange, filterOptions,
  } = opts;

  const setFilter = <K extends keyof ColumnFilters>(key: K, value: ColumnFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const cols: ColumnDef<FeedPost>[] = [
    {
      key: 'link',
      header: '',
      width: 'w-7',
      render: (row) => (
        <ExternalLinkCell
          url={row.post_url}
          hoverContent={<PostCard post={row} />}
        />
      ),
    },
  ];

  cols.push(
    // Source — platform icon + handle, filterable by platform
    {
      key: 'source',
      header: (
        <MultiSelectFilterHeader
          label="Source"
          options={filterOptions.platforms}
          selected={filters.platform}
          onChange={(v) => setFilter('platform', v)}
          renderOption={(p) => (
            <span className="flex items-center gap-1.5">
              <PlatformIcon platform={p} className="h-3.5 w-3.5" />
              <span className="font-medium">{PLATFORM_LABELS[p] || p}</span>
            </span>
          )}
        />
      ),
      width: 'w-[12%]',
      render: (row) => (
        <span className="flex items-center gap-1.5 truncate">
          <PlatformIcon platform={row.platform} className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium text-foreground/80 truncate">@{row.channel_handle}</span>
        </span>
      ),
    },

    // Content / AI Summary — stays as text search
    {
      key: 'summary',
      header: (
        <TextFilterHeader
          label="AI Summary"
          value={filters.content}
          onChange={(v) => setFilter('content', v)}
        />
      ),
      render: (row) => {
        const text = row.ai_summary || [row.title, row.content].filter(Boolean).join(' ');
        return (
          <span className="line-clamp-2 text-xs text-foreground/90" title={text || undefined}>
            {text?.slice(0, 140) || '---'}
          </span>
        );
      },
    },

    // Posted date
    {
      key: 'posted_at',
      header: 'Posted',
      width: 'w-[7%]',
      sortable: true,
      render: (row) => <span className="truncate text-xs text-muted-foreground">{timeAgo(row.posted_at)}</span>,
    },

    // Views
    {
      key: 'views',
      header: 'Views',
      width: 'w-[7%]',
      align: 'right' as const,
      sortable: true,
      render: (row) => <span className="tabular-nums text-xs font-medium">{formatNumber(row.views ?? 0)}</span>,
    },

    // Sentiment
    {
      key: 'sentiment',
      header: (
        <MultiSelectFilterHeader
          label="Sentiment"
          options={filterOptions.sentiments}
          selected={filters.sentiment}
          onChange={(v) => setFilter('sentiment', v)}
          renderOption={(s) => (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SENTIMENT_COLORS[s] }} />
              <span className="capitalize font-medium">{s}</span>
            </span>
          )}
        />
      ),
      width: 'w-[8%]',
      render: (row) => <SentimentBadge sentiment={row.sentiment} />,
    },

    // Channel Type
    {
      key: 'channel_type',
      header: (
        <MultiSelectFilterHeader
          label="Ch. Type"
          options={filterOptions.channelTypes}
          selected={filters.channelType}
          onChange={(v) => setFilter('channelType', v)}
        />
      ),
      width: 'w-[6%]',
      render: (row) => {
        const ct = row.channel_type;
        if (!ct) return <span className="text-xs text-muted-foreground">---</span>;
        const colors: Record<string, string> = {
          official: 'text-blue-600 bg-blue-500/10',
          media: 'text-amber-600 bg-amber-500/10',
          ugc: 'text-green-600 bg-green-500/10',
        };
        return (
          <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${colors[ct] ?? 'text-muted-foreground bg-muted'}`}>
            {ct}
          </span>
        );
      },
    },

    // Entities — multi-select
    {
      key: 'entities',
      header: (
        <MultiSelectFilterHeader
          label="Entities"
          options={filterOptions.entities}
          selected={filters.entities}
          onChange={(v) => setFilter('entities', v)}
        />
      ),
      width: 'w-[10%]',
      render: (row) => <EntityChips entities={parseStringList(row.entities)} />,
    },
  );

  return cols;
}
