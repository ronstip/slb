import { useMemo } from 'react';
import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import { Separator } from '../../../../components/ui/separator.tsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../components/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { X, Plus, ChevronDown } from 'lucide-react';
import { MultiSelectFilterBody, type FilterOption } from '../../../collections/ColumnFilterHeader.tsx';
import type { DashboardPost } from '../../../../api/types.ts';
import type { SocialWidgetFilters, FilterCondition, FilterConditionField, FilterConditionOperator } from '../types-social-dashboard.ts';
import {
  CONDITION_FIELD_OPTIONS,
  NUMERIC_CONDITION_FIELDS,
  DATE_CONDITION_FIELDS,
  NUMERIC_OPERATORS,
  DATE_OPERATORS,
  TEXT_OPERATORS,
  OPERATOR_LABELS,
} from '../types-social-dashboard.ts';
import type { FilterOptions } from '../use-dashboard-filters.ts';

type ArrayFilterKey = Exclude<keyof SocialWidgetFilters, 'date_range' | 'conditions' | 'custom_fields'>;

/** Per-post value extractor for each multi-select section - mirrors the match
 *  logic in applyWidgetFilters so the popover counts line up with what the
 *  filter would actually keep. Array fields (themes/entities/brands) contribute
 *  all their members; scalar fields contribute their single value. */
const SECTION_ACCESSORS: Record<ArrayFilterKey, (p: DashboardPost) => string[]> = {
  sentiment: (p) => (p.sentiment ? [p.sentiment] : []),
  emotion: (p) => (p.emotion ? [p.emotion] : []),
  platform: (p) => (p.platform ? [p.platform] : []),
  language: (p) => (p.language ? [p.language] : []),
  content_type: (p) => (p.content_type ? [p.content_type] : []),
  channel_type: (p) => (p.channel_type ? [p.channel_type] : []),
  collection: (p) => (p.collection_id ? [p.collection_id] : []),
  channels: (p) => (p.channel_handle ? [p.channel_handle] : []),
  themes: (p) => p.themes ?? [],
  entities: (p) => p.entities ?? [],
  brands: (p) => p.detected_brands ?? [],
};

/** Distinct custom-field value keys for one post, matching the option keys
 *  produced by extractOptions: scalar/array fields key on the field name,
 *  list[object] fields key each scalar leaf as `field.leaf`. */
function customValueKeys(p: DashboardPost): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, value: string) => {
    (out.get(key) ?? out.set(key, new Set()).get(key)!).add(value);
  };
  if (!p.custom_fields) return out;
  for (const [name, raw] of Object.entries(p.custom_fields)) {
    if (raw == null) continue;
    if (Array.isArray(raw) && raw.some((e) => e && typeof e === 'object' && !Array.isArray(e))) {
      for (const el of raw) {
        if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
        for (const [leaf, lv] of Object.entries(el as Record<string, unknown>)) {
          if (lv == null || typeof lv === 'object') continue;
          add(`${name}.${leaf}`, String(lv));
        }
      }
      continue;
    }
    if (Array.isArray(raw)) {
      for (const v of raw) if (v != null) add(name, String(v));
    } else {
      add(name, String(raw));
    }
  }
  return out;
}

const FILTER_SECTIONS: Array<{ label: string; key: ArrayFilterKey; placeholder: string }> = [
  { label: 'Sentiment', key: 'sentiment', placeholder: 'All sentiments' },
  { label: 'Emotion', key: 'emotion', placeholder: 'All emotions' },
  { label: 'Platform', key: 'platform', placeholder: 'All platforms' },
  { label: 'Language', key: 'language', placeholder: 'All languages' },
  { label: 'Content Type', key: 'content_type', placeholder: 'All types' },
  { label: 'Channel Type', key: 'channel_type', placeholder: 'All channel types' },
  { label: 'Themes', key: 'themes', placeholder: 'All themes' },
  { label: 'Entities', key: 'entities', placeholder: 'All entities' },
  { label: 'Brands', key: 'brands', placeholder: 'All brands' },
  { label: 'Channels', key: 'channels', placeholder: 'All channels' },
  { label: 'Collection', key: 'collection', placeholder: 'All collections' },
];

function humanizeFieldName(name: string): string {
  // Render list[object] leaf keys (men.name) as "Men › Name".
  return name
    .split('.')
    .map((part) => part.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' › ');
}

function getOperatorsForField(field: FilterConditionField): FilterConditionOperator[] {
  if (NUMERIC_CONDITION_FIELDS.includes(field)) return NUMERIC_OPERATORS;
  if (DATE_CONDITION_FIELDS.includes(field)) return DATE_OPERATORS;
  return TEXT_OPERATORS;
}

function getInputType(field: FilterConditionField): string {
  if (NUMERIC_CONDITION_FIELDS.includes(field)) return 'number';
  if (DATE_CONDITION_FIELDS.includes(field)) return 'date';
  return 'text';
}

/** A labeled multi-select filter row: form-style trigger showing the current
 *  selection summary, opening the shared MultiSelectFilterBody (search +
 *  per-value counts + Only + Select All / Clear). */
function FilterRow({
  label,
  title,
  options,
  counts,
  selected,
  placeholder,
  portalContainer,
  onChange,
}: {
  label: string;
  title?: string;
  options: string[];
  counts: Map<string, number> | undefined;
  selected: string[];
  placeholder: string;
  portalContainer?: HTMLElement | null;
  onChange: (next: string[]) => void;
}) {
  const optionList: FilterOption[] = options.map((o) => ({ value: o, count: counts?.get(o) ?? 0 }));
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const summary =
    selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="flex items-center gap-3">
      <Label className="text-xs w-24 shrink-0" title={title}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 flex-1 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-xs transition-colors hover:bg-accent/40"
          >
            <span className={selected.length ? 'truncate capitalize' : 'truncate text-muted-foreground'}>
              {summary}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          container={portalContainer}
          className="flex w-64 max-h-80 flex-col overflow-hidden p-0"
          onClick={(e) => e.stopPropagation()}
        >
          <MultiSelectFilterBody
            label={label}
            options={optionList}
            selected={selectedSet}
            onChange={(next) => onChange([...next])}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface WidgetFilterFormProps {
  filters: SocialWidgetFilters;
  availableOptions: FilterOptions;
  /** Posts feeding this widget (global-filtered, pre widget-filter) - used to
   *  compute per-value counts shown in each filter popover. */
  posts: DashboardPost[];
  /** Portal target for filter popovers - a node inside the modal Dialog so the
   *  option lists stay scrollable (react-remove-scroll blocks body portals). */
  portalContainer?: HTMLElement | null;
  onChange: (filters: SocialWidgetFilters) => void;
}

export function WidgetFilterForm({ filters, availableOptions, posts, portalContainer, onChange }: WidgetFilterFormProps) {
  // Per-value post counts for every section + custom field, computed once over
  // the widget's input posts. Each value is counted at most once per post.
  const { sectionCounts, customCounts } = useMemo(() => {
    const section: Record<string, Map<string, number>> = {};
    for (const key of Object.keys(SECTION_ACCESSORS)) section[key] = new Map();
    const custom: Record<string, Map<string, number>> = {};
    const bump = (m: Map<string, number>, v: string) => m.set(v, (m.get(v) ?? 0) + 1);

    for (const p of posts) {
      for (const [key, accessor] of Object.entries(SECTION_ACCESSORS)) {
        const m = section[key];
        for (const v of new Set(accessor(p))) bump(m, v);
      }
      for (const [key, values] of customValueKeys(p)) {
        const m = custom[key] ?? (custom[key] = new Map());
        for (const v of values) bump(m, v);
      }
    }
    return { sectionCounts: section, customCounts: custom };
  }, [posts]);
  const activeCount = Object.entries(filters).reduce((n, [k, v]) => {
    if (k === 'date_range') return n + (((v as SocialWidgetFilters['date_range'])?.from || (v as SocialWidgetFilters['date_range'])?.to) ? 1 : 0);
    if (k === 'conditions') return n + ((v as FilterCondition[])?.length ?? 0);
    if (k === 'custom_fields') {
      const cf = (v as SocialWidgetFilters['custom_fields']) ?? {};
      return n + Object.values(cf).reduce((m, vals) => m + (vals?.length ?? 0), 0);
    }
    return n + ((v as string[])?.length ?? 0);
  }, 0);

  const customFieldEntries = Object.entries(availableOptions.custom_fields ?? {})
    .filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const conditions = filters.conditions ?? [];

  const addCondition = () => {
    const newCond: FilterCondition = { field: 'like_count', operator: 'greaterThan', value: 0 };
    onChange({ ...filters, conditions: [...conditions, newCond] });
  };

  const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...filters, conditions: updated });
  };

  const removeCondition = (index: number) => {
    const updated = conditions.filter((_, i) => i !== index);
    onChange({ ...filters, conditions: updated.length ? updated : undefined });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          These filters apply <strong>on top of</strong> the global filter bar.
        </p>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange({})}>
            <X className="h-3 w-3 mr-1" />
            Clear all ({activeCount})
          </Button>
        )}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Date Range</Label>
        <div className="flex items-center gap-2 flex-1">
          <Input
            type="date"
            className="h-8 text-xs flex-1"
            value={filters.date_range?.from ?? ''}
            onChange={(e) =>
              onChange({ ...filters, date_range: { from: e.target.value || null, to: filters.date_range?.to ?? null } })
            }
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            className="h-8 text-xs flex-1"
            value={filters.date_range?.to ?? ''}
            onChange={(e) =>
              onChange({ ...filters, date_range: { from: filters.date_range?.from ?? null, to: e.target.value || null } })
            }
          />
          {(filters.date_range?.from || filters.date_range?.to) && (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange({ ...filters, date_range: { from: null, to: null } })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <Separator />

      {/* Filter sections - shared filter body (counts + Only + Select All) */}
      {FILTER_SECTIONS.map(({ label, key, placeholder }) => {
        const options = (availableOptions[key] ?? []) as string[];
        if (options.length === 0) return null;
        return (
          <FilterRow
            key={key}
            label={label}
            options={options}
            counts={sectionCounts[key]}
            selected={(filters[key] ?? []) as string[]}
            placeholder={placeholder}
            portalContainer={portalContainer}
            onChange={(selected) => onChange({ ...filters, [key]: selected.length ? selected : undefined })}
          />
        );
      })}

      {/* Custom enrichment fields - one MultiSelect per agent-defined field */}
      {customFieldEntries.length > 0 && (
        <>
          <Separator />
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Custom Fields
          </Label>
          {customFieldEntries.map(([name, options]) => {
            const selected = filters.custom_fields?.[name] ?? [];
            return (
              <FilterRow
                key={name}
                label={humanizeFieldName(name)}
                title={name}
                options={options}
                counts={customCounts[name]}
                selected={selected}
                placeholder={`All ${humanizeFieldName(name).toLowerCase()}`}
                portalContainer={portalContainer}
                onChange={(next) => {
                  const cf = { ...(filters.custom_fields ?? {}) };
                  if (next.length) cf[name] = next;
                  else delete cf[name];
                  onChange({
                    ...filters,
                    custom_fields: Object.keys(cf).length ? cf : undefined,
                  });
                }}
              />
            );
          })}
        </>
      )}

      {/* ── Advanced Conditions ── */}
      <Separator />
      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Conditions
        </Label>

        {conditions.map((cond, i) => {
          const operators = getOperatorsForField(cond.field);
          const noValue = cond.operator === 'isEmpty' || cond.operator === 'isNotEmpty';
          const isBetween = cond.operator === 'between';

          return (
            <div key={i} className="flex items-center gap-1 w-full min-w-0">
              {/* Field */}
              <Select
                value={cond.field}
                onValueChange={(field) => {
                  const ops = getOperatorsForField(field as FilterConditionField);
                  const validOp = ops.includes(cond.operator) ? cond.operator : ops[0];
                  updateCondition(i, {
                    field: field as FilterConditionField,
                    operator: validOp,
                    value: NUMERIC_CONDITION_FIELDS.includes(field as FilterConditionField) ? 0 : '',
                    value2: undefined,
                  });
                }}
              >
                <SelectTrigger className="h-8 text-xs min-w-0 flex-[2] truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_FIELD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Operator - key on field to force remount when field changes */}
              <Select
                key={`op-${i}-${cond.field}`}
                value={cond.operator}
                onValueChange={(op) => updateCondition(i, { operator: op as FilterConditionOperator })}
              >
                <SelectTrigger className="h-8 text-xs min-w-0 flex-[2] truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((op) => (
                    <SelectItem key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Value(s) */}
              {!noValue && (
                <>
                  <Input
                    type={getInputType(cond.field)}
                    value={cond.value}
                    onChange={(e) => {
                      const v = NUMERIC_CONDITION_FIELDS.includes(cond.field) ? Number(e.target.value) : e.target.value;
                      updateCondition(i, { value: v });
                    }}
                    placeholder={DATE_CONDITION_FIELDS.includes(cond.field) ? 'YYYY-MM-DD' : 'Value'}
                    className="h-8 text-xs min-w-0 flex-[1.5]"
                  />
                  {isBetween && (
                    <Input
                      type={getInputType(cond.field)}
                      value={cond.value2 ?? ''}
                      onChange={(e) => {
                        const v = NUMERIC_CONDITION_FIELDS.includes(cond.field) ? Number(e.target.value) : e.target.value;
                        updateCondition(i, { value2: v });
                      }}
                      placeholder="Value 2"
                      className="h-8 text-xs min-w-0 flex-[1.5]"
                    />
                  )}
                </>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeCondition(i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={addCondition}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Condition
        </Button>
      </div>
    </div>
  );
}
