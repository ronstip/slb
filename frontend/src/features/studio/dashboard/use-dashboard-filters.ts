import { useState, useMemo, useCallback } from 'react';
import type { DashboardPost } from '../../../api/types.ts';
import type { ReportScope } from './types-social-dashboard.ts';

export interface DashboardFilters {
  sentiment: string[];
  emotion: string[];
  entities: string[];
  language: string[];
  collection: string[];
  content_type: string[];
  platform: string[];
  themes: string[];
  channels: string[];
  /** Topic cluster ids (any-of match on each post's `topic_ids`). */
  topics: string[];
  date_range: { from: string | null; to: string | null };
}

export interface FilterOptions {
  sentiment: string[];
  emotion: string[];
  entities: string[];
  language: string[];
  collection: string[];
  content_type: string[];
  channel_type: string[];
  platform: string[];
  themes: string[];
  channels: string[];
  brands: string[];
  /** Topic cluster ids present in the data. Pill labels are resolved from the
   *  dashboard's topics list (id -> name) by the filter bar. */
  topics: string[];
  /** Distinct values per agent-defined custom enrichment field. Only used by
   *  widget-level filter UI; the global filter bar ignores these. */
  custom_fields: Record<string, string[]>;
  dateMin: string | null;
  dateMax: string | null;
}

const INITIAL_FILTERS: DashboardFilters = {
  sentiment: [],
  emotion: [],
  entities: [],
  language: [],
  collection: [],
  content_type: [],
  platform: [],
  themes: [],
  channels: [],
  topics: [],
  date_range: { from: null, to: null },
};

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

function extractOptions(posts: DashboardPost[]): FilterOptions {
  const sets: Record<string, Set<string>> = {
    sentiment: new Set(),
    emotion: new Set(),
    entities: new Set(),
    language: new Set(),
    collection: new Set(),
    content_type: new Set(),
    channel_type: new Set(),
    platform: new Set(),
    themes: new Set(),
    channels: new Set(),
    brands: new Set(),
    topics: new Set(),
  };
  const customSets: Record<string, Set<string>> = {};
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const p of posts) {
    if (p.sentiment) sets.sentiment.add(p.sentiment);
    if (p.emotion && p.emotion !== 'unknown') sets.emotion.add(p.emotion);
    if (p.language) sets.language.add(p.language);
    if (p.content_type) sets.content_type.add(p.content_type);
    if (p.channel_type) sets.channel_type.add(p.channel_type);
    sets.platform.add(p.platform);
    sets.collection.add(p.collection_id);
    if (p.channel_handle) sets.channels.add(p.channel_handle);
    for (const t of p.themes ?? []) sets.themes.add(t);
    for (const e of p.entities ?? []) sets.entities.add(e);
    for (const b of p.detected_brands ?? []) sets.brands.add(b);
    for (const tid of p.topic_ids ?? []) sets.topics.add(tid);
    if (p.custom_fields) {
      for (const [name, raw] of Object.entries(p.custom_fields)) {
        if (raw == null) continue;
        if (Array.isArray(raw) && raw.some((e) => e && typeof e === 'object' && !Array.isArray(e))) {
          // list[object] field: expose each scalar leaf as its own `field.leaf`
          // option set (men.name, men.age) instead of stringifying objects to
          // "[object Object]". Filtering stays post-level (keep/drop whole post).
          for (const el of raw) {
            if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
            for (const [leaf, lv] of Object.entries(el as Record<string, unknown>)) {
              if (lv == null || typeof lv === 'object') continue;
              const key = `${name}.${leaf}`;
              (customSets[key] ?? (customSets[key] = new Set())).add(String(lv));
            }
          }
          continue;
        }
        const target = customSets[name] ?? (customSets[name] = new Set());
        if (Array.isArray(raw)) {
          for (const v of raw) if (v != null) target.add(String(v));
        } else {
          target.add(String(raw));
        }
      }
    }
    if (p.posted_at) {
      const d = p.posted_at.slice(0, 10);
      if (!dateMin || d < dateMin) dateMin = d;
      if (!dateMax || d > dateMax) dateMax = d;
    }
  }

  const custom_fields: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(customSets)) {
    custom_fields[name] = [...values].sort();
  }

  return {
    sentiment: [...sets.sentiment].sort(),
    emotion: [...sets.emotion].sort(),
    entities: [...sets.entities].sort(),
    language: [...sets.language].sort(),
    collection: [...sets.collection].sort(),
    content_type: [...sets.content_type].sort(),
    channel_type: [...sets.channel_type].sort(),
    platform: [...sets.platform].sort(),
    themes: [...sets.themes].sort(),
    channels: [...sets.channels].sort(),
    brands: [...sets.brands].sort(),
    topics: [...sets.topics].sort(),
    custom_fields,
    dateMin,
    dateMax,
  };
}

/** Array-dimension intersection: when the scope constrains a dimension, the
 *  viewer's selection can only NARROW the scope's set, not introduce values
 *  outside it. Empty viewer selection means "all values within the scope" -
 *  we promote the scope's list to the active filter. */
function intersectArrayDimension(
  scopeValues: string[] | null | undefined,
  viewerValues: string[],
): string[] {
  if (!scopeValues || scopeValues.length === 0) return viewerValues;
  if (viewerValues.length === 0) return [...scopeValues];
  const scopeSet = new Set(scopeValues);
  return viewerValues.filter((v) => scopeSet.has(v));
}

/** Date intersection: viewer `from` can only move later than scope.from;
 *  viewer `to` can only move earlier than scope.to. Either or both ends may
 *  be open on the scope or on the viewer's selection. */
function intersectDateRange(
  scope: { from: string | null; to: string | null } | null | undefined,
  viewer: { from: string | null; to: string | null },
): { from: string | null; to: string | null } {
  if (!scope) return viewer;
  const from =
    viewer.from && scope.from
      ? viewer.from > scope.from ? viewer.from : scope.from
      : (viewer.from ?? scope.from ?? null);
  const to =
    viewer.to && scope.to
      ? viewer.to < scope.to ? viewer.to : scope.to
      : (viewer.to ?? scope.to ?? null);
  return { from, to };
}

/** Combine the report's committed scope with the viewer's current filter
 *  selections. The scope is the floor - viewer filters can narrow each
 *  dimension further but never widen past the scope. When no scope is set
 *  (standalone mode), this is the identity function. */
function intersectWithScope(
  viewer: DashboardFilters,
  scope: ReportScope | null | undefined,
): DashboardFilters {
  if (!scope) return viewer;
  return {
    sentiment: intersectArrayDimension(scope.sentiment, viewer.sentiment),
    emotion: intersectArrayDimension(scope.emotion, viewer.emotion),
    entities: intersectArrayDimension(scope.entities, viewer.entities),
    language: intersectArrayDimension(scope.language, viewer.language),
    collection: intersectArrayDimension(scope.collection, viewer.collection),
    content_type: intersectArrayDimension(scope.content_type, viewer.content_type),
    platform: intersectArrayDimension(scope.platform, viewer.platform),
    themes: intersectArrayDimension(scope.themes, viewer.themes),
    channels: intersectArrayDimension(scope.channels, viewer.channels),
    topics: intersectArrayDimension(scope.topics, viewer.topics),
    date_range: intersectDateRange(scope.date_range, viewer.date_range),
  };
}

function applyFilters(posts: DashboardPost[], filters: DashboardFilters): DashboardPost[] {
  return posts.filter((p) => {
    if (filters.sentiment.length > 0 && !filters.sentiment.includes(p.sentiment || '')) return false;
    if (filters.emotion.length > 0 && !filters.emotion.includes(p.emotion || '')) return false;
    if (filters.platform.length > 0 && !filters.platform.includes(p.platform)) return false;
    if (filters.language.length > 0 && !filters.language.includes(p.language || '')) return false;
    if (filters.content_type.length > 0 && !filters.content_type.includes(p.content_type || '')) return false;
    if (filters.collection.length > 0 && !filters.collection.includes(p.collection_id)) return false;
    if (filters.channels.length > 0 && !filters.channels.includes(p.channel_handle || '')) return false;

    if (filters.themes.length > 0) {
      const postThemes = p.themes ?? [];
      if (!filters.themes.some((t) => postThemes.includes(t))) return false;
    }

    if (filters.entities.length > 0) {
      const postEntities = p.entities ?? [];
      if (!filters.entities.some((e) => postEntities.includes(e))) return false;
    }

    if (filters.topics.length > 0) {
      const postTopics = p.topic_ids ?? [];
      if (!filters.topics.some((t) => postTopics.includes(t))) return false;
    }

    if (filters.date_range.from || filters.date_range.to) {
      const d = p.posted_at?.slice(0, 10) ?? '';
      if (filters.date_range.from && d < filters.date_range.from) return false;
      if (filters.date_range.to && d > filters.date_range.to) return false;
    }

    return true;
  });
}

export function useDashboardFilters(
  allPosts: DashboardPost[],
  reportScope?: ReportScope | null,
) {
  const [filters, setFilters] = useState<DashboardFilters>(INITIAL_FILTERS);

  // The scope is the floor for every chart aggregation. Viewer filters narrow
  // within it; they cannot widen past it. When no scope is committed (standalone
  // dashboards), this is the identity transformation and behavior is unchanged.
  const effectiveFilters = useMemo(
    () => intersectWithScope(filters, reportScope),
    [filters, reportScope],
  );

  const filteredPosts = useMemo(
    () => applyFilters(allPosts, effectiveFilters),
    [allPosts, effectiveFilters],
  );
  const availableOptions = useMemo(() => extractOptions(allPosts), [allPosts]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const key of Object.keys(filters) as (keyof DashboardFilters)[]) {
      if (key === 'date_range') {
        if (filters.date_range.from || filters.date_range.to) count += 1;
      } else {
        count += filters[key].length;
      }
    }
    return count;
  }, [filters]);

  const setFilter = useCallback(<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleFilterValue = useCallback((key: ArrayFilterKey, value: string) => {
    setFilters((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }, []);

  const clearAll = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  return {
    filters,
    setFilter,
    toggleFilterValue,
    filteredPosts,
    availableOptions,
    activeFilterCount,
    clearAll,
    effectiveFilters,
  };
}
