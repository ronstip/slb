import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import { Separator } from '../../../../components/ui/separator.tsx';
import { MultiSelect } from '../../../../components/ui/multi-select.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { X, Plus } from 'lucide-react';
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

type ArrayFilterKey = Exclude<keyof SocialWidgetFilters, 'date_range' | 'conditions'>;

const FILTER_SECTIONS: Array<{ label: string; key: ArrayFilterKey; placeholder: string }> = [
  { label: 'Sentiment', key: 'sentiment', placeholder: 'All sentiments' },
  { label: 'Emotion', key: 'emotion', placeholder: 'All emotions' },
  { label: 'Platform', key: 'platform', placeholder: 'All platforms' },
  { label: 'Language', key: 'language', placeholder: 'All languages' },
  { label: 'Content Type', key: 'content_type', placeholder: 'All types' },
  { label: 'Themes', key: 'themes', placeholder: 'All themes' },
  { label: 'Entities', key: 'entities', placeholder: 'All entities' },
  { label: 'Channels', key: 'channels', placeholder: 'All channels' },
  { label: 'Collection', key: 'collection', placeholder: 'All collections' },
];

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

interface WidgetFilterFormProps {
  filters: SocialWidgetFilters;
  availableOptions: FilterOptions;
  onChange: (filters: SocialWidgetFilters) => void;
}

export function WidgetFilterForm({ filters, availableOptions, onChange }: WidgetFilterFormProps) {
  const activeCount = Object.entries(filters).reduce((n, [k, v]) => {
    if (k === 'date_range') return n + (((v as SocialWidgetFilters['date_range'])?.from || (v as SocialWidgetFilters['date_range'])?.to) ? 1 : 0);
    if (k === 'conditions') return n + ((v as FilterCondition[])?.length ?? 0);
    return n + ((v as string[])?.length ?? 0);
  }, 0);

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

      {/* Filter sections — each using MultiSelect dropdown */}
      {FILTER_SECTIONS.map(({ label, key, placeholder }) => {
        const options = (availableOptions[key] ?? []) as string[];
        if (options.length === 0) return null;
        return (
          <div key={key} className="flex items-center gap-3">
            <Label className="text-xs w-24 shrink-0">{label}</Label>
            <MultiSelect
              value={(filters[key] ?? []) as string[]}
              options={options.map((o) => ({ label: o, value: o }))}
              onChange={(selected) => onChange({ ...filters, [key]: selected.length ? selected : undefined })}
              placeholder={placeholder}
              className="flex-1"
            />
          </div>
        );
      })}

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

              {/* Operator — key on field to force remount when field changes */}
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
