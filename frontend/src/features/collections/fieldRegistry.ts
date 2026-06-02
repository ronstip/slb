// Field registry for the posts table - single source of truth for which
// fields exist (built-in + agent custom), how to read them, and what filter
// operators apply. Both the per-column header filters and the ColumnPicker
// consume this so they can't drift apart.

import type { FeedPost, CustomFieldDef } from '../../api/types.ts';

export type FieldKind =
  | 'enum'       // single string from a finite set (sentiment, channel_type, ...)
  | 'multi_enum' // list-of-string (themes, entities, detected_brands)
  | 'text'       // free-form string (title, content, ai_summary, channel_handle, ...)
  | 'number'
  | 'bool'
  | 'date';

export interface FieldDef {
  key: string;            // canonical key, e.g. "sentiment" or "cf:brand_mentioned"
  label: string;          // display label
  kind: FieldKind;
  source: 'builtin' | 'custom';
  accessor: (p: FeedPost) => unknown;
  /** Pre-known options for enum fields (literal custom_fields, sentiment, etc.). */
  knownOptions?: string[];
}

const BUILTIN_FIELDS: FieldDef[] = [
  { key: 'platform',       label: 'Platform',      kind: 'enum',       source: 'builtin', accessor: (p) => p.platform },
  { key: 'channel_handle', label: 'Channel',       kind: 'enum',       source: 'builtin', accessor: (p) => p.channel_handle },
  { key: 'channel_type',   label: 'Ch. Type',      kind: 'enum',       source: 'builtin', accessor: (p) => p.channel_type, knownOptions: ['official', 'media', 'influencer', 'ugc'] },
  { key: 'title',          label: 'Title',         kind: 'text',       source: 'builtin', accessor: (p) => p.title },
  { key: 'content',        label: 'Content',       kind: 'text',       source: 'builtin', accessor: (p) => p.content },
  { key: 'ai_summary',     label: 'AI Summary',    kind: 'text',       source: 'builtin', accessor: (p) => p.ai_summary },
  { key: 'context',        label: 'Context',       kind: 'text',       source: 'builtin', accessor: (p) => p.context },
  { key: 'posted_at',      label: 'Posted',        kind: 'date',       source: 'builtin', accessor: (p) => p.posted_at },
  { key: 'post_type',      label: 'Post Type',     kind: 'enum',       source: 'builtin', accessor: (p) => p.post_type },
  { key: 'sentiment',      label: 'Sentiment',     kind: 'enum',       source: 'builtin', accessor: (p) => p.sentiment, knownOptions: ['positive', 'neutral', 'negative'] },
  { key: 'emotion',        label: 'Emotion',       kind: 'enum',       source: 'builtin', accessor: (p) => p.emotion },
  { key: 'content_type',   label: 'Content Type',  kind: 'enum',       source: 'builtin', accessor: (p) => p.content_type },
  { key: 'language',       label: 'Language',      kind: 'enum',       source: 'builtin', accessor: (p) => p.language },
  { key: 'themes',         label: 'Themes',        kind: 'multi_enum', source: 'builtin', accessor: (p) => p.themes },
  { key: 'entities',       label: 'Entities',      kind: 'multi_enum', source: 'builtin', accessor: (p) => p.entities },
  { key: 'detected_brands',label: 'Brands',        kind: 'multi_enum', source: 'builtin', accessor: (p) => p.detected_brands },
  { key: 'views',          label: 'Views',         kind: 'number',     source: 'builtin', accessor: (p) => p.views },
  { key: 'likes',          label: 'Likes',         kind: 'number',     source: 'builtin', accessor: (p) => p.likes },
  { key: 'shares',         label: 'Shares',        kind: 'number',     source: 'builtin', accessor: (p) => p.shares },
  { key: 'comments_count', label: 'Comments',      kind: 'number',     source: 'builtin', accessor: (p) => p.comments_count },
  { key: 'saves',          label: 'Saves',         kind: 'number',     source: 'builtin', accessor: (p) => p.saves },
  { key: 'total_engagement',label: 'Engagement',   kind: 'number',     source: 'builtin', accessor: (p) => p.total_engagement },
  { key: 'is_retweet',     label: 'Retweet',       kind: 'bool',       source: 'builtin', accessor: (p) => p.is_retweet },
  { key: 'is_quote',       label: 'Quote',         kind: 'bool',       source: 'builtin', accessor: (p) => p.is_quote },
];

/** Map a custom field definition to a generic FieldDef. */
function customFieldToFieldDef(cf: CustomFieldDef): FieldDef {
  const key = `cf:${cf.name}`;
  const accessor = (p: FeedPost) => {
    const cfs = p.custom_fields;
    if (!cfs || typeof cfs !== 'object' || Array.isArray(cfs)) return undefined;
    return (cfs as Record<string, unknown>)[cf.name];
  };
  switch (cf.type) {
    case 'literal':
      return { key, label: cf.name, kind: 'enum', source: 'custom', accessor, knownOptions: cf.options ?? [] };
    case 'bool':
      return { key, label: cf.name, kind: 'bool', source: 'custom', accessor };
    case 'int':
    case 'float':
      return { key, label: cf.name, kind: 'number', source: 'custom', accessor };
    case 'list[str]':
      return { key, label: cf.name, kind: 'multi_enum', source: 'custom', accessor };
    case 'str':
    default:
      return { key, label: cf.name, kind: 'text', source: 'custom', accessor };
  }
}

/** Build the merged field registry for an agent. Pass `customFields=null` when
 *  the agent has none (or isn't loaded yet) and you'll just get built-ins. */
export function buildFieldRegistry(customFields: CustomFieldDef[] | null | undefined): FieldDef[] {
  if (!customFields || customFields.length === 0) return BUILTIN_FIELDS;
  return [...BUILTIN_FIELDS, ...customFields.map(customFieldToFieldDef)];
}

export function findField(registry: FieldDef[], key: string): FieldDef | undefined {
  return registry.find((f) => f.key === key);
}

/** Collect unique values for an enum/multi_enum field from the actual posts.
 *  Combines with `knownOptions` so users see the full schema even when no rows
 *  exhibit a given value yet. Returns options sorted by count desc, with 0-count
 *  entries from the schema appended last. */
export function extractFieldOptions(field: FieldDef, posts: FeedPost[]): { value: string; count: number }[] {
  if (field.kind !== 'enum' && field.kind !== 'multi_enum') return [];
  const counts = new Map<string, number>();
  for (const p of posts) {
    const raw = field.accessor(p);
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      for (const v of raw) {
        if (typeof v === 'string' && v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    } else if (typeof raw === 'string' && raw) {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  const known = field.knownOptions ?? [];
  for (const k of known) {
    if (!counts.has(k)) counts.set(k, 0);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
