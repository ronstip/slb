import { useState, useMemo, useCallback } from 'react';
import type { DashboardPost } from '../../../api/types.ts';

export interface DashboardFilters {
  sentiment: string[];
  entities: string[];
  language: string[];
  collection: string[];
  content_type: string[];
  platform: string[];
  themes: string[];
  channels: string[];
  date_range: { from: string | null; to: string | null };
}

export interface FilterOptions {
  sentiment: string[];
  entities: string[];
  language: string[];
  collection: string[];
  content_type: string[];
  platform: string[];
  themes: string[];
  channels: string[];
  dateMin: string | null;
  dateMax: string | null;
}

const INITIAL_FILTERS: DashboardFilters = {
  sentiment: [],
  entities: [],
  language: [],
  collection: [],
  content_type: [],
  platform: [],
  themes: [],
  channels: [],
  date_range: { from: null, to: null },
};

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

function extractOptions(posts: DashboardPost[]): FilterOptions {
  const sets: Record<string, Set<string>> = {
    sentiment: new Set(),
    entities: new Set(),
    language: new Set(),
    collection: new Set(),
    content_type: new Set(),
    platform: new Set(),
    themes: new Set(),
    channels: new Set(),
  };
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const p of posts) {
    if (p.sentiment) sets.sentiment.add(p.sentiment);
    if (p.language) sets.language.add(p.language);
    if (p.content_type) sets.content_type.add(p.content_type);
    sets.platform.add(p.platform);
    sets.collection.add(p.collection_id);
    if (p.channel_handle) sets.channels.add(p.channel_handle);
    for (const t of p.themes ?? []) sets.themes.add(t);
    for (const e of p.entities ?? []) sets.entities.add(e);
    if (p.posted_at) {
      const d = p.posted_at.slice(0, 10);
      if (!dateMin || d < dateMin) dateMin = d;
      if (!dateMax || d > dateMax) dateMax = d;
    }
  }

  return {
    sentiment: [...sets.sentiment].sort(),
    entities: [...sets.entities].sort(),
    language: [...sets.language].sort(),
    collection: [...sets.collection].sort(),
    content_type: [...sets.content_type].sort(),
    platform: [...sets.platform].sort(),
    themes: [...sets.themes].sort(),
    channels: [...sets.channels].sort(),
    dateMin,
    dateMax,
  };
}

function applyFilters(posts: DashboardPost[], filters: DashboardFilters): DashboardPost[] {
  return posts.filter((p) => {
    if (filters.sentiment.length > 0 && !filters.sentiment.includes(p.sentiment || '')) return false;
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

    if (filters.date_range.from || filters.date_range.to) {
      const d = p.posted_at?.slice(0, 10) ?? '';
      if (filters.date_range.from && d < filters.date_range.from) return false;
      if (filters.date_range.to && d > filters.date_range.to) return false;
    }

    return true;
  });
}

export function useDashboardFilters(allPosts: DashboardPost[]) {
  const [filters, setFilters] = useState<DashboardFilters>(INITIAL_FILTERS);

  const filteredPosts = useMemo(() => applyFilters(allPosts, filters), [allPosts, filters]);
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
  };
}
