import type { DashboardPost } from '../../../api/types.ts';
import type {
  CustomChartConfig,
  CustomDimension,
  CustomMetric,
  CustomTableConfig,
  ParsedObjectMetric,
  WidgetData,
} from './types-social-dashboard.ts';
import {
  defaultAggForObjectMetric,
  isDimensionColumn,
  isPostFieldColumn,
  normalizeTableConfig,
  parseObjectDim,
  parseObjectMetric,
} from './types-social-dashboard.ts';
import type { TableRow } from './dashboard-aggregations.ts';
import { getDimensionKeys, getMetricValue } from './dashboard-aggregations.ts';

// ─── Element-as-unit aggregation for list[object] custom fields ───────────────
// Each object in a post's `custom_fields[field]` array is one observation. A post
// with N objects contributes N element rows. Metrics come in four kinds (see
// parseObjectMetric):
//   count         → # of elements
//   distinctPosts → # of distinct parent posts (deduped per post)
//   own           → aggregate of the object's own numeric leaf (e.g. avg age)
//   inherited     → each element inherits its parent post's metric (e.g. views),
//                   per element (full value each — co-occurring elements both
//                   carry the post's full value).
// This path is SEPARATE from the post-keyed `aggregateCustom` and only handles
// object dim/metric tokens (see objectFieldOf).

const DEFAULT_TOP_N = 50;
// Breakdown groups beyond this make the legend unreadable (matches aggregateCustom).
const DEFAULT_BREAKDOWN_LIMIT = 10;

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

/** Paired element + its parent post, so inherited / distinct-post metrics can
 *  read post-level fields the element itself doesn't carry. */
interface ElementWithPost {
  el: Record<string, unknown>;
  post: DashboardPost;
}

/** Flatten every element object of `fieldName` across all posts, keeping each
 *  element's parent post. */
function flattenElements(posts: DashboardPost[], fieldName: string): ElementWithPost[] {
  const out: ElementWithPost[] = [];
  for (const post of posts) {
    const raw = post.custom_fields?.[fieldName];
    if (!Array.isArray(raw)) continue;
    for (const el of raw) {
      if (el && typeof el === 'object' && !Array.isArray(el)) {
        out.push({ el: el as Record<string, unknown>, post });
      }
    }
  }
  return out;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Narrow a config metricAgg (which may include KPI-only aggs like median/
 *  distinct/mode/percent) to the stat-based aggs this module supports. Anything
 *  unsupported drops to undefined so aggFor falls back to the kind default. */
function coerceAgg(agg: string | undefined): MetricAgg | undefined {
  switch (agg) {
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'count':
      return agg;
    default:
      return undefined;
  }
}

/** Resolve the aggregation for an object metric, honoring the config override and
 *  falling back to the kind default (own→avg, inherited→sum, count→count). */
function aggFor(kind: ParsedObjectMetric['kind'], override: MetricAgg | undefined): MetricAgg {
  if (kind === 'count') return 'count';
  return override ?? defaultAggForObjectMetric(kind) ?? 'sum';
}

/** The numeric contribution of one (element, post) for count/own/inherited
 *  metrics. Returns null when the element has no value to add (own leaf missing).
 *  distinctPosts is handled separately via a post-id set. */
function elementValue(parsed: ParsedObjectMetric, ewp: ElementWithPost): number | null {
  switch (parsed.kind) {
    case 'count':     return 1;
    case 'inherited': return getMetricValue(ewp.post, parsed.metric as CustomMetric);
    case 'own':       return toNumber(ewp.el[parsed.leaf as string]);
    default:          return null; // distinctPosts - not value-based
  }
}

/** Resolve the grouping key(s) one element contributes for a dimension. An
 *  object-leaf dim (`custom:field.leaf`) reads the element itself → at most one
 *  key. Any other (post-level) dim is inherited from the parent post via
 *  getDimensionKeys → 0 keys (post lacks it → element drops out), 1 key (scalar /
 *  date bucket), or N keys (multi-valued post field → element fans into each, a
 *  co-occurrence count). Element-as-unit holds throughout: the metric still
 *  counts/aggregates elements, we only attribute each to its post's value(s). */
function dimKeysForElement(ewp: ElementWithPost, dim: string, timeBucket: string): string[] {
  const obj = parseObjectDim(dim);
  if (obj) {
    const v = ewp.el[obj.leaf];
    return v == null ? [] : [String(v)];
  }
  return getDimensionKeys(ewp.post, dim as CustomDimension, timeBucket);
}

// ─── Grouped accumulator ──────────────────────────────────────────────────────
// Each group tracks Stats (count/own/inherited) and a post-id set (distinctPosts).

interface GroupAcc {
  stats: Stats;
  posts: Set<string>;
}

function emptyGroup(): GroupAcc {
  return { stats: emptyStats(), posts: new Set() };
}

function mergeGroup(a: GroupAcc, b: GroupAcc): GroupAcc {
  a.stats = mergeStats(a.stats, b.stats);
  for (const id of b.posts) a.posts.add(id);
  return a;
}

/** Add one (element, post) contribution to a group, honoring the metric kind. */
function accumulateInto(g: GroupAcc, parsed: ParsedObjectMetric, ewp: ElementWithPost): void {
  if (parsed.kind === 'distinctPosts') {
    g.posts.add(ewp.post.post_id);
    return;
  }
  const n = elementValue(parsed, ewp);
  // No value (e.g. missing own leaf) - keep the group but don't fake a 0.
  if (n !== null) addStat(g.stats, n);
}

function resolveGroup(g: GroupAcc, kind: ParsedObjectMetric['kind'], agg: MetricAgg): number {
  return kind === 'distinctPosts' ? g.posts.size : resolveStats(g.stats, agg);
}

function rankAndPick(
  acc: Map<string, GroupAcc>,
  kind: ParsedObjectMetric['kind'],
  agg: MetricAgg,
  topN: number,
  includeOthers: boolean | undefined,
): WidgetData {
  const ranked = [...acc.entries()]
    .map(([label, g]) => ({ label, group: g, value: resolveGroup(g, kind, agg) }))
    .sort((a, b) => b.value - a.value);

  const top = ranked.slice(0, topN);
  const tail = ranked.slice(topN);

  const labels = top.map((r) => r.label);
  const values = top.map((r) => r.value);

  if (includeOthers && tail.length > 0) {
    const merged = emptyGroup();
    for (const r of tail) {
      merged.stats = mergeStats(merged.stats, r.group.stats);
      for (const id of r.group.posts) merged.posts.add(id);
    }
    labels.push('Others');
    values.push(resolveGroup(merged, kind, agg));
  }

  const total = values.reduce((s, v) => s + v, 0);
  return { value: total, labels, values };
}

/** Aggregate a `list[object]` custom field, element-as-unit. */
export function aggregateObjectList(
  posts: DashboardPost[],
  fieldName: string,
  config: CustomChartConfig,
): WidgetData {
  const elements = flattenElements(posts, fieldName);
  const metricParsed = parseObjectMetric(config.metric as string);
  // Unparseable metric defaults to count-of-elements.
  const kind: ParsedObjectMetric['kind'] = metricParsed?.kind ?? 'count';
  const parsed: ParsedObjectMetric = metricParsed ?? { field: fieldName, kind: 'count' };
  const agg = aggFor(kind, coerceAgg(config.metricAgg));

  const timeBucket = config.timeBucket ?? 'day';
  const dim = config.dimension as string | undefined;

  // ── No dimension → single number card ──
  if (!dim) {
    if (kind === 'distinctPosts') {
      const ids = new Set<string>();
      for (const ewp of elements) ids.add(ewp.post.post_id);
      return { value: ids.size, labels: ['Posts'], values: [ids.size] };
    }
    if (kind === 'count') {
      return { value: elements.length, labels: ['Count'], values: [elements.length] };
    }
    const s = emptyStats();
    for (const ewp of elements) {
      const n = elementValue(parsed, ewp);
      if (n !== null) addStat(s, n);
    }
    const value = resolveStats(s, agg);
    const label = kind === 'inherited' ? (parsed.metric as string) : parsed.leaf ?? 'value';
    return { value, labels: [label], values: [value] };
  }

  // ── Grouped + broken down by a second dimension ──
  // Both axes accept an object leaf of this field OR an inherited post field.
  const breakdownDim =
    config.breakdownDimension && config.breakdownDimension !== config.dimension
      ? (config.breakdownDimension as string)
      : null;
  if (breakdownDim) {
    return aggregateObjectBreakdown(elements, parsed, kind, agg, dim, breakdownDim, timeBucket, config);
  }

  // ── Single-dimension grouping (object leaf or inherited post field) ──
  const acc = new Map<string, GroupAcc>();
  for (const ewp of elements) {
    for (const key of dimKeysForElement(ewp, dim, timeBucket)) {
      const g = acc.get(key) ?? emptyGroup();
      acc.set(key, g);
      accumulateInto(g, parsed, ewp);
    }
  }

  // Temporal dim → chronological series (no value re-rank / topN).
  if (dim === 'posted_at') {
    const resolved = [...acc.entries()]
      .map(([label, g]) => ({ label, value: resolveGroup(g, kind, agg) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const total = resolved.reduce((s, r) => s + r.value, 0);
    return {
      value: total,
      labels: resolved.map((r) => r.label),
      values: resolved.map((r) => r.value),
      timeSeries: resolved.map((r) => ({ date: r.label, value: r.value })),
    };
  }

  return rankAndPick(acc, kind, agg, config.topN ?? DEFAULT_TOP_N, config.includeOthers);
}

/** Two-dimensional pivot, element-as-unit: primary × breakdown, where each axis
 *  is an object leaf of this field OR an inherited post field. Mirrors the
 *  post-side `aggregateCustom` breakdown branches — a temporal primary yields
 *  `groupedTimeSeries` (multi-line), any other primary yields a stacked
 *  `groupedCategorical`. Multi-valued post fields fan each element into every
 *  value (co-occurrence), consistent with the post-side path. */
function aggregateObjectBreakdown(
  elements: ElementWithPost[],
  parsed: ParsedObjectMetric,
  kind: ParsedObjectMetric['kind'],
  agg: MetricAgg,
  primaryDim: string,
  breakdownDim: string,
  timeBucket: string,
  config: CustomChartConfig,
): WidgetData {
  const acc2d = new Map<string, Map<string, GroupAcc>>(); // primary → breakdown → acc
  for (const ewp of elements) {
    const pKeys = dimKeysForElement(ewp, primaryDim, timeBucket);
    if (!pKeys.length) continue;
    const bKeys = dimKeysForElement(ewp, breakdownDim, timeBucket);
    if (!bKeys.length) continue;
    for (const pk of pKeys) {
      let inner = acc2d.get(pk);
      if (!inner) { inner = new Map(); acc2d.set(pk, inner); }
      for (const bk of bKeys) {
        const g = inner.get(bk) ?? emptyGroup();
        inner.set(bk, g);
        accumulateInto(g, parsed, ewp);
      }
    }
  }

  // Breakdown series ranked by merged total across primaries, capped.
  const breakdownAcc = new Map<string, GroupAcc>();
  for (const inner of acc2d.values()) {
    for (const [bLabel, g] of inner) {
      mergeGroup(breakdownAcc.get(bLabel) ?? breakdownAcc.set(bLabel, emptyGroup()).get(bLabel)!, g);
    }
  }
  const topBreakdowns = [...breakdownAcc.entries()]
    .map(([label, g]) => ({ label, value: resolveGroup(g, kind, agg) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, DEFAULT_BREAKDOWN_LIMIT)
    .map((r) => r.label);

  // Temporal primary → multi-line series over chronological dates.
  if (primaryDim === 'posted_at') {
    const dates = [...acc2d.keys()].sort((a, b) => a.localeCompare(b));
    const grouped: Record<string, Array<{ date: string; value: number }>> = {};
    for (const bk of topBreakdowns) {
      grouped[bk] = dates.map((date) => {
        const g = acc2d.get(date)?.get(bk);
        return { date, value: g ? resolveGroup(g, kind, agg) : 0 };
      });
    }
    let grandTotal = 0;
    for (const series of Object.values(grouped)) for (const p of series) grandTotal += p.value;
    return { value: grandTotal, groupedTimeSeries: grouped };
  }

  // Categorical primary → stacked, with topN / Others on the primary axis.
  const primaryRanked = [...acc2d.entries()]
    .map(([label, inner]) => {
      const merged = emptyGroup();
      for (const g of inner.values()) mergeGroup(merged, g);
      return { label, value: resolveGroup(merged, kind, agg) };
    })
    .sort((a, b) => b.value - a.value);
  const primaryLimit = config.topN ?? DEFAULT_TOP_N;
  const topPrimary = primaryRanked.slice(0, primaryLimit).map((r) => r.label);
  const tailPrimary = primaryRanked.slice(primaryLimit).map((r) => r.label);

  const primaryLabels = [...topPrimary];
  if (config.includeOthers && tailPrimary.length > 0) primaryLabels.push('Others');

  const cellValue = (pLabel: string, bLabel: string): number => {
    if (pLabel === 'Others') {
      const merged = emptyGroup();
      for (const tail of tailPrimary) {
        const g = acc2d.get(tail)?.get(bLabel);
        if (g) mergeGroup(merged, g);
      }
      return resolveGroup(merged, kind, agg);
    }
    const g = acc2d.get(pLabel)?.get(bLabel);
    return g ? resolveGroup(g, kind, agg) : 0;
  };

  const datasets = topBreakdowns.map((bLabel) => ({
    label: bLabel,
    values: primaryLabels.map((pLabel) => cellValue(pLabel, bLabel)),
  }));

  const grandTotal = datasets.reduce((s, ds) => s + ds.values.reduce((a, b) => a + b, 0), 0);
  return { value: grandTotal, groupedCategorical: { labels: primaryLabels, datasets } };
}

const COMPOUND_SEP = '';

/**
 * Element-as-unit grouped TABLE for a list[object] field. Rows are keyed by the
 * compound of the table's object dimension columns (categorical leaves, e.g.
 * men.name); metric columns are object metrics (count / distinct posts / numeric
 * leaf / inherited post metric). Same element-as-unit guarantee as
 * `aggregateObjectList` - each object is one observation.
 */
export function aggregateObjectTable(
  posts: DashboardPost[],
  fieldName: string,
  rawConfig: CustomTableConfig,
): TableRow[] {
  const config = normalizeTableConfig(rawConfig);
  const { columns, sortBy, sortDir = 'desc', rowLimit = 25 } = config;
  const dimCols = columns.filter(isDimensionColumn);
  const metricCols = columns.filter((c) => !isDimensionColumn(c) && !isPostFieldColumn(c));

  const elements = flattenElements(posts, fieldName);

  // compound key → {dim leaf values, per-metric-column accumulators}
  const acc = new Map<string, { dimValues: string[]; perMetric: Map<string, GroupAcc> }>();
  for (const ewp of elements) {
    const dimValues: string[] = [];
    let skip = false;
    for (const col of dimCols) {
      const parsed = parseObjectDim((col.dimension as string) ?? '');
      const v = parsed ? ewp.el[parsed.leaf] : null;
      if (v == null) { skip = true; break; }
      dimValues.push(String(v));
    }
    if (skip) continue; // element missing a grouping leaf - excluded from all rows

    const key = dimValues.length ? dimValues.join(COMPOUND_SEP) : '__all__';
    let entry = acc.get(key);
    if (!entry) {
      entry = { dimValues, perMetric: new Map() };
      acc.set(key, entry);
    }
    for (const col of metricCols) {
      const pm = parseObjectMetric((col.metric as string) ?? '');
      if (!pm) continue;
      const g = entry.perMetric.get(col.id) ?? emptyGroup();
      entry.perMetric.set(col.id, g);
      if (pm.kind === 'distinctPosts') {
        g.posts.add(ewp.post.post_id);
        continue;
      }
      const n = elementValue(pm, ewp);
      if (n !== null) addStat(g.stats, n);
    }
  }

  const rows: TableRow[] = [];
  for (const [key, entry] of acc) {
    const row: TableRow = { __key: key };
    let dimIdx = 0;
    for (const col of columns) {
      if (isDimensionColumn(col)) {
        row[col.id] = entry.dimValues[dimIdx] ?? '';
        dimIdx += 1;
      } else if (isPostFieldColumn(col)) {
        row[col.id] = '';
      } else if (col.metric) {
        const pm = parseObjectMetric((col.metric as string) ?? '');
        const g = entry.perMetric.get(col.id) ?? emptyGroup();
        const kind: ParsedObjectMetric['kind'] = pm?.kind ?? 'count';
        row[col.id] = resolveGroup(g, kind, aggFor(kind, col.agg));
      }
    }
    rows.push(row);
  }

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
