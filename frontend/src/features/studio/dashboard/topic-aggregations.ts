import type { TopicMetric } from '../../../api/types.ts';
import type {
  CustomChartConfig,
  CustomTableConfig,
  TableColumn,
  TopicDimension,
  TopicMetric as TopicMetricKey,
  WidgetData,
} from './types-social-dashboard.ts';
import {
  TOPIC_JSON_UNNESTED_DIMENSIONS,
  TOPIC_RATIO_METRICS,
  defaultTopicMetricAgg,
  isDimensionColumn,
  normalizeTableConfig,
} from './types-social-dashboard.ts';
import type { TableRow } from './dashboard-aggregations.ts';

const DEFAULT_TOP_N = 50;

type MetricAgg = 'sum' | 'avg' | 'min' | 'max' | 'count';
type Stats = { sum: number; count: number; min: number; max: number };

function emptyStats(): Stats {
  return { sum: 0, count: 0, min: Infinity, max: -Infinity };
}

function addStat(s: Stats, val: number): Stats {
  s.sum += val;
  s.count += 1;
  if (val < s.min) s.min = val;
  if (val > s.max) s.max = val;
  return s;
}

function mergeStats(a: Stats, b: Stats): Stats {
  return {
    sum: a.sum + b.sum,
    count: a.count + b.count,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
  };
}

function resolveStats(s: Stats, agg: MetricAgg): number {
  switch (agg) {
    case 'avg': return s.count > 0 ? s.sum / s.count : 0;
    case 'min': return s.min === Infinity ? 0 : s.min;
    case 'max': return s.max === -Infinity ? 0 : s.max;
    case 'count': return s.count;
    default: return s.sum;
  }
}

/** Pull a topic-level scalar metric off a TopicMetric row. `topic_count` is 1
 *  per row (so callers summing it across rows get a topic count). */
function getTopicMetricValue(t: TopicMetric, metric: TopicMetricKey): number {
  switch (metric) {
    case 'topic_count':             return 1;
    case 'post_count':              return t.post_count ?? 0;
    case 'total_views':             return t.total_views ?? 0;
    case 'total_likes':             return t.total_likes ?? 0;
    case 'total_engagement':        return t.total_engagement ?? 0;
    case 'avg_engagement_per_post': return t.avg_engagement_per_post ?? 0;
    case 'signal_score':            return t.signal_score ?? 0;
    case 'recency_score':           return t.recency_score ?? 0;
    case 'net_sentiment':           return t.net_sentiment ?? 0;
    case 'sov_posts':               return t.sov_posts ?? 0;
    case 'sov_views':                return t.sov_views ?? 0;
    case 'sov_engagement':          return t.sov_engagement ?? 0;
    case 'estimated_post_count':    return t.estimated_post_count ?? 0;
    case 'estimated_views':         return t.estimated_views ?? 0;
    case 'unique_channels':         return t.unique_channels ?? 0;
  }
}

/** Pull the scalar dimension key off a TopicMetric row. Returns the empty
 *  bucket label when the field is missing — keeps every topic visible rather
 *  than silently dropping rows. */
function getScalarTopicDimKey(t: TopicMetric, dim: TopicDimension): string {
  switch (dim) {
    case 'topic':            return t.header ?? `(topic ${t.cluster_id})`;
    case 'beat_type':        return t.beat_type ?? 'unknown';
    case 'top_content_type': return t.top_content_type ?? 'unknown';
    case 'top_emotion':      return t.top_emotion ?? 'unknown';
    default:                 return 'unknown';
  }
}

/** For a JSON-unnested dimension, return the (value, perEntryCount) pairs for a
 *  given topic. `perEntryCount` is the value of the entry's `count` (or `posts`
 *  for platforms_breakdown) — the per-(topic, value) weight that count-style
 *  metrics use. Ratio metrics ignore it and use the topic-level value instead. */
function getJsonDimEntries(
  t: TopicMetric,
  dim: TopicDimension,
): Array<{ value: string; entryCount: number; platformEntry?: { posts: number; views: number; likes: number; engagement: number } }> {
  switch (dim) {
    case 'platform':
      return (t.platforms_breakdown ?? []).map((e) => ({
        value: e.platform,
        entryCount: e.posts,
        platformEntry: { posts: e.posts, views: e.views, likes: e.likes, engagement: e.engagement },
      }));
    case 'theme':
      return (t.themes_counts ?? []).map((e) => ({ value: e.value, entryCount: e.count }));
    case 'entity':
      return (t.entities_counts ?? []).map((e) => ({ value: e.value, entryCount: e.count }));
    case 'brand':
      return (t.detected_brands_counts ?? []).map((e) => ({ value: e.value, entryCount: e.count }));
    case 'channel_type':
      return (t.channel_type_counts ?? []).map((e) => ({ value: e.value, entryCount: e.count }));
    case 'emotion':
      return (t.emotion_counts ?? []).map((e) => ({ value: e.value, entryCount: e.count }));
    default:
      return [];
  }
}

/** For platforms_breakdown only, the entry carries per-platform views/likes/
 *  engagement. Route count-style metrics to the matching column directly so
 *  e.g. `platform × total_views` shows actual per-platform views, not the
 *  topic's full view count copied to every platform. */
function platformEntryValue(
  entry: { posts: number; views: number; likes: number; engagement: number },
  metric: TopicMetricKey,
): number | null {
  switch (metric) {
    case 'post_count':       return entry.posts;
    case 'total_views':      return entry.views;
    case 'total_likes':      return entry.likes;
    case 'total_engagement': return entry.engagement;
    default:                 return null;
  }
}

/** Aggregate topic rows for chart/number-card widgets. Mirrors aggregateCustom
 *  on the posts side but operates over TopicMetric rows (already aggregated).
 *
 *  Topic widgets are snapshot data — no time series, no 2D breakdowns in phase 1.
 *  The renderer must guard against `dimension === 'posted_at'` and
 *  `breakdownDimension` being set; this function ignores both. */
export function aggregateTopicsCustom(
  topics: TopicMetric[],
  config: CustomChartConfig,
): WidgetData {
  const metric = config.metric as TopicMetricKey;
  const dimension = config.dimension as TopicDimension | undefined;
  const topN = config.topN ?? DEFAULT_TOP_N;
  const includeOthers = config.includeOthers;
  const metricAgg: MetricAgg =
    (config.metricAgg as MetricAgg | undefined) ?? defaultTopicMetricAgg(metric);

  // ── Number-card: reduce metric across all topics ─────────────────────
  if (!dimension) {
    if (metric === 'topic_count') {
      return { value: topics.length, labels: ['Topic Count'], values: [topics.length] };
    }
    const vals = topics.map((t) => getTopicMetricValue(t, metric));
    let value = 0;
    switch (metricAgg) {
      case 'avg':   value = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; break;
      case 'min':   value = vals.length > 0 ? Math.min(...vals) : 0; break;
      case 'max':   value = vals.length > 0 ? Math.max(...vals) : 0; break;
      case 'count': value = vals.length; break;
      default:      value = vals.reduce((a, b) => a + b, 0); break;
    }
    return { value, labels: [metric], values: [value] };
  }

  // ── JSON-unnested dimension: expand each topic's breakdown ───────────
  if (TOPIC_JSON_UNNESTED_DIMENSIONS.has(dimension)) {
    const acc = new Map<string, Stats>();
    for (const t of topics) {
      const entries = getJsonDimEntries(t, dimension);
      const topicVal = getTopicMetricValue(t, metric);
      for (const entry of entries) {
        let weight: number;
        if (metric === 'topic_count') {
          weight = 1;
        } else if (entry.platformEntry) {
          const pv = platformEntryValue(entry.platformEntry, metric);
          // For metrics not in the platform entry struct (e.g. signal_score)
          // fall back to the topic-level value at this entry.
          weight = pv ?? topicVal;
        } else if (TOPIC_RATIO_METRICS.has(metric)) {
          // Ratios aren't decomposable per breakdown value — copy the topic-
          // level value at each (topic, value) pair. UI blocks this combo
          // but a stale widget config may still hit this path.
          weight = topicVal;
        } else {
          // Count-only breakdowns (themes/entities/emotion/brand/channel_type)
          // expose only `count` per entry. That's per-topic posts-with-value
          // — the most natural mapping for post_count/views/etc.
          weight = entry.entryCount;
        }
        const s = acc.get(entry.value) ?? emptyStats();
        addStat(s, weight);
        acc.set(entry.value, s);
      }
    }
    return rankAndPick(acc, metricAgg, topN, includeOthers, false);
  }

  // ── Scalar dimension: group topics, emit 1:1 mapping for `topic` ─────
  const isTopicDim = dimension === 'topic';
  const acc = new Map<string, Stats>();
  const clusterIdByKey = new Map<string, string>();
  for (const t of topics) {
    const key = getScalarTopicDimKey(t, dimension);
    const val = metric === 'topic_count' ? 1 : getTopicMetricValue(t, metric);
    const s = acc.get(key) ?? emptyStats();
    addStat(s, val);
    acc.set(key, s);
    if (isTopicDim && !clusterIdByKey.has(key)) {
      clusterIdByKey.set(key, t.cluster_id);
    }
  }
  return rankAndPick(acc, metricAgg, topN, includeOthers, isTopicDim ? clusterIdByKey : false);
}

/** Sort by resolved value desc, take topN, optionally roll the tail into
 *  "Others". When `clusterMap` is a Map, populate `clusterIds` parallel to
 *  labels (with `undefined` for the Others bucket); otherwise omit them. */
function rankAndPick(
  acc: Map<string, Stats>,
  metricAgg: MetricAgg,
  topN: number,
  includeOthers: boolean | undefined,
  clusterMap: Map<string, string> | false,
): WidgetData {
  const ranked = [...acc.entries()]
    .map(([label, s]) => ({ label, stats: s, value: resolveStats(s, metricAgg) }))
    .sort((a, b) => b.value - a.value);

  const top = ranked.slice(0, topN);
  const tail = ranked.slice(topN);

  const labels = top.map((r) => r.label);
  const values = top.map((r) => r.value);
  const clusterIds = clusterMap ? labels.map((l) => clusterMap.get(l)) : undefined;

  if (includeOthers && tail.length > 0) {
    let merged = emptyStats();
    for (const r of tail) merged = mergeStats(merged, r.stats);
    labels.push('Others');
    values.push(resolveStats(merged, metricAgg));
    if (clusterIds) clusterIds.push(undefined);
  }

  const total = values.reduce((s, v) => s + v, 0);
  const out: WidgetData = { value: total, labels, values };
  if (clusterIds) out.clusterIds = clusterIds;
  return out;
}

/** Resolve the value for a topic table cell. Dimension columns return the
 *  scalar field; JSON-unnested dim columns return the top-N entry labels
 *  joined as a comma list. Metric columns return the raw per-topic value
 *  (no aggregation — rows are 1:1 with topics). */
function getTopicTableCell(t: TopicMetric, col: TableColumn): number | string {
  if (isDimensionColumn(col)) {
    const dim = col.dimension as TopicDimension | undefined;
    if (!dim) return '';
    if (TOPIC_JSON_UNNESTED_DIMENSIONS.has(dim)) {
      const entries = getJsonDimEntries(t, dim);
      return entries
        .slice(0, 3)
        .map((e) => e.value)
        .join(', ');
    }
    return getScalarTopicDimKey(t, dim);
  }
  const metric = col.metric as TopicMetricKey | undefined;
  if (!metric) return 0;
  return getTopicMetricValue(t, metric);
}

/** Table aggregator for topic widgets. One row per topic — no grouping. Sort
 *  by configured column, then slice to rowLimit. Populates the rows' `__key`
 *  with the cluster_id so the renderer's click-through can navigate. */
export function aggregateTopicsTable(
  topics: TopicMetric[],
  rawConfig: CustomTableConfig,
): TableRow[] {
  const config = normalizeTableConfig(rawConfig);
  const { columns, sortBy, sortDir = 'desc', rowLimit = 25 } = config;

  const rows: TableRow[] = topics.map((t) => {
    const row: TableRow = { __key: t.cluster_id };
    for (const col of columns) {
      row[col.id] = getTopicTableCell(t, col);
    }
    return row;
  });

  const sortKey = sortBy ?? columns[0]?.id;
  if (sortKey) {
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return dir * (Number(av ?? 0) - Number(bv ?? 0));
    });
  }

  return rows.slice(0, rowLimit);
}
