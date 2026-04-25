import type { CustomFieldDef } from '../../api/types.ts';

export interface GroupByOption {
  value: string;
  label: string;
}

export const STANDARD_GROUP_BY: GroupByOption[] = [
  { value: 'sentiment',    label: 'Sentiment' },
  { value: 'emotion',      label: 'Emotion' },
  { value: 'theme',        label: 'Theme / Topic' },
  { value: 'platform',     label: 'Platform' },
  { value: 'content type', label: 'Content Type' },
  { value: 'language',     label: 'Language' },
  { value: 'channel',      label: 'Channel' },
  { value: 'entity',       label: 'Entity' },
  { value: 'brand',        label: 'Brand' },
  { value: 'date',         label: 'Date' },
];

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildGroupByOptions(customFields?: CustomFieldDef[] | null): GroupByOption[] {
  const custom = (customFields ?? [])
    .filter((f) => f.name && f.type !== 'bool' && f.type !== 'float' && f.type !== 'int')
    .map((f) => ({ value: f.name, label: humanize(f.name) }));
  return [...STANDARD_GROUP_BY, ...custom];
}
