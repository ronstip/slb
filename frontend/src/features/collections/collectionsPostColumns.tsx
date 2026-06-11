import type { ReactNode } from 'react';
import type { ColumnDef } from '../../components/DataTable/DataTable.tsx';
import type { FeedPost } from '../../api/types.ts';
import {
  ExternalLinkCell,
  SentimentBadge,
  EntityChips,
  parseStringList,
} from '../../components/DataTable/cells.tsx';
import { PostCard } from '../studio/PostCard.tsx';
import { PostActionsMenu } from '../post-overrides/PostActionsMenu.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import {
  MultiSelectFilterHeader,
  TextFilterHeader,
  NumberRangeFilterHeader,
  BoolFilterHeader,
  DateRangeFilterHeader,
} from './ColumnFilterHeader.tsx';
import { type FieldDef, extractFieldOptions, URL_FIELD } from './fieldRegistry.ts';
import type { ColumnPref } from './ColumnPicker.tsx';

/* ------------------------------------------------------------------ */
/* Unified column filter state - keyed by FieldDef.key. Shape varies   */
/* by field kind. Empty / absent value means no filter on that column. */
/* ------------------------------------------------------------------ */

export interface ColumnFilterValue {
  selected?: string[];           // enum / multi_enum
  contains?: string;             // text
  min?: number;                  // number
  max?: number;                  // number
  equals?: boolean;              // bool
  from?: string;                 // date (ISO)
  to?: string;                   // date (ISO)
}

export type ColumnFilters = Record<string, ColumnFilterValue>;

export function createEmptyFilters(): ColumnFilters {
  return {};
}

export function hasActiveFilters(f: ColumnFilters): boolean {
  for (const v of Object.values(f)) {
    if (isFilterActive(v)) return true;
  }
  return false;
}

function isFilterActive(v: ColumnFilterValue | undefined): boolean {
  if (!v) return false;
  return (
    (v.selected != null && v.selected.length > 0) ||
    (typeof v.contains === 'string' && v.contains.length > 0) ||
    v.min != null ||
    v.max != null ||
    v.equals != null ||
    (typeof v.from === 'string' && v.from.length > 0) ||
    (typeof v.to === 'string' && v.to.length > 0)
  );
}

/* Canonicalise a post URL so cosmetic variants of the SAME post compare equal:
 *  different path types, tracking query params, mobile/amp subdomains, www and
 *  protocol all collapse. Each platform keys on its native post id (mirrors the
 *  backend `parse_post_url` in workers/collection/url_parsers.py). Unrecognised
 *  URLs fall back to a generic strip so they still match their own variants.
 *
 *  Search-only - never persisted. The post id is kept verbatim (Instagram and
 *  YouTube ids are case-sensitive); only the domain / path-type is folded. When
 *  in doubt we under-normalise rather than risk merging two different posts. */
type UrlMatcher = (s: string) => string | null;

// twitter / x: status id is globally unique, so the @handle is decorative.
// twitter.com == x.com; mobile. and tracking ?s=&t= drop out.
const matchTwitter: UrlMatcher = (s) => {
  const m = s.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:[^/?#]+\/status|i\/web\/status|i\/status|statuses)\/(\d+)/i);
  return m ? `twitter.com/status/${m[1]}` : null;
};

// instagram: shortcode. reel|reels|tv|p all address the same post.
const matchInstagram: UrlMatcher = (s) => {
  const m = s.match(/^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? `instagram.com/p/${m[1]}` : null;
};

// tiktok: numeric video/photo id (the @handle is stable but the id alone is unique).
const matchTiktok: UrlMatcher = (s) => {
  const m = s.match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/?#]+\/(?:video|photo)\/(\d+)/i);
  return m ? `tiktok.com/video/${m[1]}` : null;
};

// youtube: id lives in ?v= (must be read BEFORE stripping the query), or in
// youtu.be/<id>, /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>.
const matchYoutube: UrlMatcher = (s) => {
  const byPath = s.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|v\/|live\/)([A-Za-z0-9_-]+)/i);
  if (byPath) return `youtube.com/v/${byPath[1]}`;
  const short = s.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]+)/i);
  return short ? `youtube.com/v/${short[1]}` : null;
};

// reddit: base-36 comment id; subreddit + title slug are decorative. old/np/amp/m subdomains.
const matchReddit: UrlMatcher = (s) => {
  const full = s.match(/^https?:\/\/(?:www\.|old\.|np\.|amp\.|m\.)?reddit\.com\/(?:r\/[^/?#]+\/)?comments\/([A-Za-z0-9]+)/i);
  if (full) return `reddit.com/comments/${full[1]}`;
  const short = s.match(/^https?:\/\/redd\.it\/([A-Za-z0-9]+)/i);
  return short ? `reddit.com/comments/${short[1]}` : null;
};

// facebook: many shapes - pull the numeric post/video id where it's unambiguous.
const matchFacebook: UrlMatcher = (s) => {
  const byPath = s.match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:watch\/?\?(?:[^#]*&)?v=|reel\/|[^/?#]+\/(?:videos|posts)\/)(\d+)/i);
  if (byPath) return `facebook.com/${byPath[1]}`;
  const story = s.match(/story_fbid=(\d+)/i);
  return story ? `facebook.com/${story[1]}` : null;
};

const URL_MATCHERS: UrlMatcher[] = [
  matchTwitter, matchInstagram, matchTiktok, matchYoutube, matchReddit, matchFacebook,
];

export function normalizeUrl(u: string): string {
  const s = u.trim();
  for (const match of URL_MATCHERS) {
    const canonical = match(s);
    if (canonical) return canonical;
  }
  // Generic fallback for unrecognised hosts: strip protocol, noise subdomains,
  // query, fragment and trailing slash, then lowercase.
  return s
    .replace(/[?#].*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www|m|mobile|amp)\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function matchOne(field: FieldDef, raw: unknown, v: ColumnFilterValue): boolean {
  switch (field.kind) {
    case 'enum': {
      if (!v.selected || v.selected.length === 0) return true;
      return typeof raw === 'string' && v.selected.includes(raw);
    }
    case 'multi_enum': {
      if (!v.selected || v.selected.length === 0) return true;
      const arr = Array.isArray(raw) ? raw : [];
      return arr.some((x) => typeof x === 'string' && v.selected!.includes(x));
    }
    case 'text': {
      if (!v.contains) return true;
      const hay = typeof raw === 'string' ? raw.toLowerCase() : raw == null ? '' : String(raw).toLowerCase();
      return hay.includes(v.contains.toLowerCase());
    }
    case 'url': {
      if (!v.contains) return true;
      const hay = normalizeUrl(typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
      return hay.includes(normalizeUrl(v.contains));
    }
    case 'number': {
      if (v.min == null && v.max == null) return true;
      if (raw == null) return false;
      const n = Number(raw);
      if (Number.isNaN(n)) return false;
      if (v.min != null && n < v.min) return false;
      if (v.max != null && n > v.max) return false;
      return true;
    }
    case 'bool': {
      if (v.equals == null) return true;
      return Boolean(raw) === v.equals;
    }
    case 'date': {
      if (!v.from && !v.to) return true;
      if (raw == null) return false;
      const s = String(raw);
      if (v.from && s < v.from) return false;
      if (v.to && s > v.to) return false;
      return true;
    }
  }
}

export function applyColumnFilters(
  posts: FeedPost[],
  filters: ColumnFilters,
  registry: FieldDef[],
): FeedPost[] {
  const entries = Object.entries(filters).filter(([, v]) => isFilterActive(v));
  if (entries.length === 0) return posts;
  const byKey = new Map(registry.map((f) => [f.key, f]));
  return posts.filter((p) => entries.every(([key, v]) => {
    const field = byKey.get(key);
    if (!field) return true; // stale filter on field that's no longer in scope
    return matchOne(field, field.accessor(p), v);
  }));
}

/* ------------------------------------------------------------------ */
/* Generic value rendering for fields without a bespoke renderer.      */
/* ------------------------------------------------------------------ */

function renderGenericValue(field: FieldDef, value: unknown): ReactNode {
  if (value == null || (typeof value === 'string' && value === '')) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  switch (field.kind) {
    case 'bool':
      return <span className="text-xs">{value ? '✓' : '✗'}</span>;
    case 'number':
      return <span className="tabular-nums text-xs">{formatNumber(Number(value))}</span>;
    case 'date':
      return <span className="text-xs text-muted-foreground">{timeAgo(String(value))}</span>;
    case 'multi_enum': {
      const arr = Array.isArray(value) ? value.map(String) : parseStringList(value as string);
      if (arr.length === 0) return <span className="text-xs text-muted-foreground">-</span>;
      return (
        <div className="flex flex-wrap gap-1 overflow-hidden">
          {arr.slice(0, 2).map((v) => (
            <span key={v} className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {v}
            </span>
          ))}
          {arr.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{arr.length - 2}</span>
          )}
        </div>
      );
    }
    case 'enum':
      return (
        <span className="inline-block rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-foreground/80">
          {String(value)}
        </span>
      );
    case 'text':
    default: {
      const s = typeof value === 'string' ? value : JSON.stringify(value);
      return (
        <span className="line-clamp-2 text-xs text-foreground/90" title={s}>
          {s.slice(0, 140)}
        </span>
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Filter header per field kind                                        */
/* ------------------------------------------------------------------ */

interface FilterHeaderProps {
  field: FieldDef;
  label: string;
  filter: ColumnFilterValue | undefined;
  setFilter: (next: ColumnFilterValue) => void;
  allPosts: FeedPost[];
  /** Optional custom renderer for each enum option (e.g. platform icon, sentiment dot). */
  renderOption?: (value: string, count: number) => ReactNode;
}

function FilterHeaderForField({
  field, label, filter, setFilter, allPosts, renderOption,
}: FilterHeaderProps) {
  const v = filter ?? {};
  switch (field.kind) {
    case 'enum':
    case 'multi_enum': {
      const options = extractFieldOptions(field, allPosts);
      const selected = new Set(v.selected ?? []);
      return (
        <MultiSelectFilterHeader
          label={label}
          options={options}
          selected={selected}
          onChange={(s) => setFilter({ ...v, selected: [...s] })}
          renderOption={renderOption}
        />
      );
    }
    case 'text':
    case 'url':
      return (
        <TextFilterHeader
          label={label}
          value={v.contains ?? ''}
          onChange={(s) => setFilter({ ...v, contains: s })}
        />
      );
    case 'number':
      return (
        <NumberRangeFilterHeader
          label={label}
          value={{ min: v.min, max: v.max }}
          onChange={(r) => setFilter({ ...v, min: r.min, max: r.max })}
        />
      );
    case 'bool':
      return (
        <BoolFilterHeader
          label={label}
          value={v.equals}
          onChange={(b) => setFilter({ ...v, equals: b })}
        />
      );
    case 'date':
      return (
        <DateRangeFilterHeader
          label={label}
          value={{ from: v.from, to: v.to }}
          onChange={(r) => setFilter({ ...v, from: r.from, to: r.to })}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/* Bespoke cell renderers - only for columns that need rich rendering. */
/* The HEADER for these is still the generic FilterHeaderForField, but */
/* with an enum option renderer to keep the platform icon / sentiment  */
/* dot affordances we had before.                                       */
/* ------------------------------------------------------------------ */

const CHANNEL_TYPE_COLORS: Record<string, string> = {
  official: 'text-blue-600 bg-blue-500/10',
  media: 'text-amber-600 bg-amber-500/10',
  ugc: 'text-green-600 bg-green-500/10',
};

interface BespokeColumnSpec {
  width?: string;
  /** Minimum pixel width - drives the table's horizontal-scroll threshold. */
  minWidth?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  render: (row: FeedPost) => ReactNode;
  /** Optional custom enum-option renderer (only meaningful for enum fields). */
  renderOption?: (value: string, count: number) => ReactNode;
  /** Override the header label (defaults to FieldDef.label). */
  headerLabel?: string;
}

const BESPOKE_COLUMNS: Record<string, BespokeColumnSpec> = {
  platform: {
    width: 'w-[5%]',
    minWidth: 56,
    render: (row) => (
      <span className="flex items-center" title={PLATFORM_LABELS[row.platform] || row.platform}>
        <PlatformIcon platform={row.platform} className="h-4 w-4 shrink-0" />
      </span>
    ),
    renderOption: (p) => (
      <span className="flex items-center gap-1.5">
        <PlatformIcon platform={p} className="h-3.5 w-3.5" />
        <span className="font-medium">{PLATFORM_LABELS[p] || p}</span>
      </span>
    ),
  },
  channel_handle: {
    width: 'w-[10%]',
    render: (row) => (
      <span className="block truncate text-xs font-medium text-foreground/80" title={`@${row.channel_handle}`}>
        @{row.channel_handle}
      </span>
    ),
    renderOption: (v) => <span className="font-medium">@{v}</span>,
  },
  ai_summary: {
    headerLabel: 'AI Summary',
    minWidth: 240,
    render: (row) => {
      const text = row.ai_summary || [row.title, row.content].filter(Boolean).join(' ');
      return (
        <span className="line-clamp-2 text-xs text-foreground/90" title={text || undefined}>
          {text?.slice(0, 140) || '---'}
        </span>
      );
    },
  },
  posted_at: {
    width: 'w-[7%]',
    sortable: true,
    render: (row) => <span className="truncate text-xs text-muted-foreground">{timeAgo(row.posted_at)}</span>,
  },
  views: {
    width: 'w-[7%]',
    align: 'right' as const,
    sortable: true,
    render: (row) => {
      const v = row.views ?? 0;
      return v === 0
        ? <span className="text-xs text-muted-foreground">-</span>
        : <span className="tabular-nums text-xs font-medium">{formatNumber(v)}</span>;
    },
  },
  likes: {
    width: 'w-[6%]',
    align: 'right' as const,
    sortable: true,
    render: (row) => <span className="tabular-nums text-xs font-medium">{formatNumber(row.likes ?? 0)}</span>,
  },
  comments_count: {
    width: 'w-[7%]',
    align: 'right' as const,
    sortable: true,
    render: (row) => <span className="tabular-nums text-xs font-medium">{formatNumber(row.comments_count ?? 0)}</span>,
  },
  shares: {
    width: 'w-[6%]',
    align: 'right' as const,
    sortable: true,
    render: (row) => <span className="tabular-nums text-xs font-medium">{formatNumber(row.shares ?? 0)}</span>,
  },
  sentiment: {
    width: 'w-[8%]',
    render: (row) => <SentimentBadge sentiment={row.sentiment} />,
    renderOption: (s) => (
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SENTIMENT_COLORS[s] }} />
        <span className="capitalize font-medium">{s}</span>
      </span>
    ),
  },
  channel_type: {
    width: 'w-[6%]',
    headerLabel: 'Ch. Type',
    render: (row) => {
      const ct = row.channel_type;
      if (!ct) return <span className="text-xs text-muted-foreground">---</span>;
      return (
        <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${CHANNEL_TYPE_COLORS[ct] ?? 'text-muted-foreground bg-muted'}`}>
          {ct}
        </span>
      );
    },
  },
  entities: {
    width: 'w-[10%]',
    render: (row) => <EntityChips entities={parseStringList(row.entities)} />,
  },
};

/* ------------------------------------------------------------------ */
/* Column builder                                                      */
/* ------------------------------------------------------------------ */

interface CollectionPostColumnsOptions {
  filters: ColumnFilters;
  onFiltersChange: (filters: ColumnFilters) => void;
  /** Field registry (built-ins + agent custom fields). */
  registry: FieldDef[];
  /** Visible-key list with order. Only entries with `visible: true` are rendered. */
  columnPrefs: ColumnPref[];
  /** All posts (pre-filter) - used to derive enum option lists with counts. */
  allPosts: FeedPost[];
  /** When set, the right-most column shows a per-row actions menu (Exclude / Edit). */
  agentId?: string;
}

export function collectionsPostColumns(
  opts: CollectionPostColumnsOptions,
): ColumnDef<FeedPost>[] {
  const { filters, onFiltersChange, registry, columnPrefs, allPosts, agentId } = opts;

  const byKey = new Map(registry.map((f) => [f.key, f]));
  const setFilterFor = (key: string, next: ColumnFilterValue) => {
    onFiltersChange({ ...filters, [key]: next });
  };

  // Always-on leading column: external-link / hover preview. Header carries a
  // paste-a-URL text filter (matched via URL_FIELD in applyColumnFilters).
  const cols: ColumnDef<FeedPost>[] = [
    {
      key: '__link',
      header: (
        <TextFilterHeader
          label=""
          value={filters[URL_FIELD.key]?.contains ?? ''}
          onChange={(s) => setFilterFor(URL_FIELD.key, { ...filters[URL_FIELD.key], contains: s })}
          placeholder="Filter by URL..."
        />
      ),
      width: 'w-9',
      minWidth: 44,
      render: (row) => (
        <ExternalLinkCell url={row.post_url} hoverContent={<PostCard post={row} />} />
      ),
    },
  ];

  for (const pref of columnPrefs) {
    if (!pref.visible) continue;
    const field = byKey.get(pref.key);
    if (!field) continue;

    const bespoke = BESPOKE_COLUMNS[pref.key];
    const label = bespoke?.headerLabel ?? field.label;

    const header = (
      <FilterHeaderForField
        field={field}
        label={label}
        filter={filters[pref.key]}
        setFilter={(v) => setFilterFor(pref.key, v)}
        allPosts={allPosts}
        renderOption={bespoke?.renderOption}
      />
    );

    cols.push({
      key: pref.key,
      header,
      width: bespoke?.width,
      minWidth: bespoke?.minWidth,
      align: bespoke?.align,
      sortable: bespoke?.sortable,
      render: bespoke
        ? bespoke.render
        : (row) => renderGenericValue(field, field.accessor(row)),
    });
  }

  if (agentId) {
    cols.push({
      key: '__actions',
      header: '',
      width: 'w-8',
      minWidth: 40,
      render: (row) => <PostActionsMenu post={row} agentId={agentId} />,
    });
  }

  return cols;
}
