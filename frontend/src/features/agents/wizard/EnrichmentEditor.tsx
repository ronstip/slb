import { useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plus, Sparkles, X } from 'lucide-react';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { cn } from '../../../lib/utils.ts';
import type { CustomFieldDef, CustomFieldType } from '../../../api/types.ts';

const FIELD_TYPES: CustomFieldType[] = ['str', 'bool', 'int', 'float', 'list[str]', 'literal'];
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

interface EnrichmentEditorProps {
  context: string;
  onContextChange: (v: string) => void;
  customFields: CustomFieldDef[];
  onCustomFieldsChange: (next: CustomFieldDef[]) => void;
  /** True when the values were populated by the AI planner and not yet edited. */
  generatedByAI: boolean;
}

export function EnrichmentEditor({
  context,
  onContextChange,
  customFields,
  onCustomFieldsChange,
  generatedByAI,
}: EnrichmentEditorProps) {
  const [open, setOpen] = useState(customFields.length > 0 || context.length > 0);

  const updateField = (idx: number, patch: Partial<CustomFieldDef>) => {
    const next = customFields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onCustomFieldsChange(next);
  };

  const removeField = (idx: number) => {
    onCustomFieldsChange(customFields.filter((_, i) => i !== idx));
  };

  const addField = () => {
    onCustomFieldsChange([
      ...customFields,
      { name: '', description: '', type: 'str' as CustomFieldType },
    ]);
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
      >
        <div className="flex items-center gap-2">
          <span className="text-foreground">Enrichment (advanced)</span>
          {generatedByAI && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Sparkles className="h-3 w-3" />
              AI
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-4 px-3 pb-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Relevance context
            </Label>
            <Textarea
              value={context}
              onChange={(e) => onContextChange(e.target.value)}
              placeholder="What makes a post relevant to this agent?"
              className="text-xs min-h-16"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Custom fields</Label>
              <button
                type="button"
                onClick={addField}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
              >
                <Plus className="h-3 w-3" />
                Add field
              </button>
            </div>

            {customFields.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                No custom fields. The enricher will still capture sentiment, emotion, and themes by default.
              </p>
            ) : (
              <div className="space-y-2">
                {customFields.map((f, idx) => (
                  <CustomFieldRow
                    key={idx}
                    field={f}
                    onChange={(patch) => updateField(idx, patch)}
                    onRemove={() => removeField(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomFieldRowProps {
  field: CustomFieldDef;
  onChange: (patch: Partial<CustomFieldDef>) => void;
  onRemove: () => void;
}

function CustomFieldRow({ field, onChange, onRemove }: CustomFieldRowProps) {
  const [optionDraft, setOptionDraft] = useState('');
  const nameValid = !field.name || NAME_RE.test(field.name);
  const needsOptions = field.type === 'literal';

  const addOption = () => {
    const v = optionDraft.trim();
    if (!v) return;
    const existing = field.options ?? [];
    if (existing.includes(v)) {
      setOptionDraft('');
      return;
    }
    onChange({ options: [...existing, v] });
    setOptionDraft('');
  };

  const removeOption = (v: string) => {
    onChange({ options: (field.options ?? []).filter((o) => o !== v) });
  };

  const handleOptionKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addOption();
    }
  };

  return (
    <div className="rounded-lg border border-border/50 bg-background p-2 space-y-2">
      <div className="flex gap-2">
        <Input
          value={field.name}
          onChange={(e) => onChange({ name: e.target.value.toLowerCase() })}
          placeholder="field_name"
          className={cn('text-xs h-7 flex-1', !nameValid && 'border-destructive')}
        />
        <Select
          value={field.type}
          onValueChange={(v) =>
            onChange({ type: v as CustomFieldType, options: v === 'literal' ? field.options ?? [] : null })
          }
        >
          <SelectTrigger className="h-7 text-xs w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove field"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Input
        value={field.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="What this field captures"
        className="text-xs h-7"
      />

      {needsOptions && (
        <div>
          <div className="flex gap-2">
            <Input
              value={optionDraft}
              onChange={(e) => setOptionDraft(e.target.value)}
              onKeyDown={handleOptionKey}
              placeholder="Add option and press Enter"
              className="text-xs h-7"
            />
          </div>
          {(field.options ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(field.options ?? []).map((o) => (
                <Badge key={o} variant="secondary" className="gap-1 text-[10px]">
                  {o}
                  <X
                    className="h-2.5 w-2.5 cursor-pointer hover:text-destructive pointer-events-auto"
                    onClick={() => removeOption(o)}
                  />
                </Badge>
              ))}
            </div>
          )}
          {(field.options ?? []).length === 0 && (
            <p className="text-[10px] text-destructive mt-1">At least one option required</p>
          )}
        </div>
      )}

      {!nameValid && (
        <p className="text-[10px] text-destructive">
          Lowercase snake_case, must start with a letter
        </p>
      )}
    </div>
  );
}
