import { useState, useRef, type KeyboardEvent } from 'react';
import { ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { cn } from '../../../lib/utils.ts';
import type { PlanStatus } from './AgentCreationWizard.tsx';
import type { WizardClarification } from '../../../api/types.ts';

interface DescribePanelProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  onQuickPrompt: (prompt: string) => void;
  onContinue: () => void;
  planStatus: PlanStatus;
  isStale: boolean;
  clarifications: WizardClarification[];
  clarificationAnswers: Record<string, string[]>;
  onClarificationAnswer: (id: string, values: string[]) => void;
  onClarificationSubmit: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Track my brand', prompt: 'Track what people are saying about my brand across social media' },
  { label: 'Compare competitors', prompt: 'Compare my brand against competitors on social media' },
  { label: 'Measure a campaign', prompt: 'Measure how our latest campaign is performing on social media' },
  { label: 'Monitor for crises', prompt: 'Monitor social media for any negative sentiment or crisis around my brand' },
];

export function DescribePanel({
  description,
  onDescriptionChange,
  onQuickPrompt,
  onContinue,
  planStatus,
  isStale,
  clarifications,
  clarificationAnswers,
  onClarificationAnswer,
  onClarificationSubmit,
}: DescribePanelProps) {
  const isClarifying = planStatus === 'clarifying';
  const isPlanning = planStatus === 'planning';
  const hasPlan = planStatus === 'ready' || planStatus === 'error';
  const canContinue = description.trim().length >= 10 && !isPlanning;

  const allAnswered = isClarifying && clarifications.every(
    (c) => (clarificationAnswers[c.id]?.length ?? 0) > 0,
  );

  let buttonLabel: string;
  if (isPlanning) buttonLabel = 'Planning\u2026';
  else if (isClarifying) buttonLabel = 'Waiting for answers\u2026';
  else if (hasPlan && isStale) buttonLabel = 'Re-plan';
  else if (hasPlan) buttonLabel = 'Re-plan';
  else buttonLabel = 'Continue';

  return (
    <div className="flex flex-col rounded-2xl border border-primary/20 bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          1
        </span>
        <h3 className="text-lg font-semibold text-primary tracking-tight">
          Describe what you need
        </h3>
      </div>

      <p className="text-[13px] text-muted-foreground mb-4">
        Tell us what you want to monitor, track, or analyze
      </p>

      <Textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="e.g., Track what people are saying about Apple Vision Pro across all social platforms..."
        className="min-h-[100px] resize-none text-sm"
        disabled={isPlanning || isClarifying}
      />

      {/* Clarification questions */}
      {isClarifying && clarifications.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] font-medium text-primary/70 uppercase tracking-wider">
            A few quick questions
          </p>
          {clarifications.map((c) => (
            <ClarificationPrompt
              key={c.id}
              clarification={c}
              values={clarificationAnswers[c.id] ?? []}
              onChange={(vals) => onClarificationAnswer(c.id, vals)}
            />
          ))}
          <Button
            type="button"
            onClick={onClarificationSubmit}
            disabled={!allAnswered}
            className="w-full gap-1.5"
            size="sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Continue
          </Button>
        </div>
      )}

      {/* Main continue button (hidden during clarification) */}
      {!isClarifying && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex-1 gap-1.5"
            size="sm"
          >
            {isPlanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {buttonLabel}
          </Button>
        </div>
      )}

      {hasPlan && isStale && !isPlanning && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
          Description changed — click Re-plan to refresh.
        </p>
      )}

      {/* Quick prompts (hidden during clarification) */}
      {!isClarifying && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
            Quick start
          </p>
          {QUICK_PROMPTS.map(({ label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => onQuickPrompt(prompt)}
              disabled={isPlanning}
              className={cn(
                'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all',
                'hover:bg-primary/5 disabled:opacity-50',
                description === prompt && 'bg-primary/10',
              )}
            >
              <span className="flex-1 text-[13px] text-foreground/70 group-hover:text-primary">
                {label}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Clarification prompt renderers ──────────────────────────────────

function ClarificationPrompt({
  clarification: c,
  values,
  onChange,
}: {
  clarification: WizardClarification;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="rounded-lg border border-primary/10 bg-primary/[0.02] p-3">
      <p className="text-sm font-medium text-foreground mb-2">{c.question}</p>
      {c.type === 'pill_row' && (
        <PillRow options={c.options ?? []} values={values} onChange={onChange} multiSelect={c.multi_select} />
      )}
      {c.type === 'card_select' && (
        <CardSelect options={c.options ?? []} values={values} onChange={onChange} />
      )}
      {c.type === 'tag_input' && (
        <TagInput values={values} onChange={onChange} placeholder={c.placeholder} />
      )}
    </div>
  );
}

function PillRow({
  options,
  values,
  onChange,
  multiSelect,
}: {
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
  multiSelect?: boolean;
}) {
  const toggle = (val: string) => {
    if (multiSelect) {
      onChange(values.includes(val) ? values.filter((v) => v !== val) : [...values, val]);
    } else {
      onChange([val]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = values.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CardSelect({
  options,
  values,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const active = values.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange([opt.value])}
            className={cn(
              'flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
              active
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/30',
            )}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            {opt.description && (
              <span className="text-[12px] text-muted-foreground">{opt.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = () => {
    const tag = input.trim();
    if (tag && !values.includes(tag)) {
      onChange([...values, tag]);
    }
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {values.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 text-xs">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={placeholder ?? 'Type and press Enter'}
        className="h-8 text-sm"
      />
    </div>
  );
}
