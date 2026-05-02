import { useRef, useState } from 'react';
import {
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Mail,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react';
import type { AgentOutput, AgentOutputType } from '../../../api/endpoints/agents.ts';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { Switch } from '../../../components/ui/switch.tsx';
import { cn } from '../../../lib/utils.ts';

interface OutputTypeMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconTint: string;
  description: string;
  defaultConfig: () => AgentOutput['config'];
}

const TYPE_META: Record<AgentOutputType, OutputTypeMeta> = {
  briefing: {
    label: 'Briefing',
    icon: FileText,
    iconTint: 'text-indigo-500',
    description: 'Written insight report',
    defaultConfig: () => ({ template: 'exec' }),
  },
  slides: {
    label: 'Slide deck',
    icon: Presentation,
    iconTint: 'text-amber-500',
    description: 'PPTX presentation',
    defaultConfig: () => ({ audience: '' }),
  },
  email: {
    label: 'Email',
    icon: Mail,
    iconTint: 'text-rose-500',
    description: 'Send findings via email',
    defaultConfig: () => ({ recipients: [], format: 'briefing' }),
  },
  data_export: {
    label: 'Data export',
    icon: FileSpreadsheet,
    iconTint: 'text-slate-500',
    description: 'CSV/JSON of collected rows',
    defaultConfig: () => ({ export_format: 'csv' }),
  },
  post_examples: {
    label: 'Post examples',
    icon: FileBarChart,
    iconTint: 'text-violet-500',
    description: 'Curated representative posts',
    defaultConfig: () => ({ count: 6 }),
  },
};

const ALL_TYPES: AgentOutputType[] = [
  'briefing',
  'slides',
  'email',
  'data_export',
  'post_examples',
];

interface OutputsListEditorProps {
  outputs: AgentOutput[];
  onChange: (outputs: AgentOutput[]) => void;
  readOnly?: boolean;
  generatedByAI?: boolean;
  /** Compact rendering for the wizard column. */
  compact?: boolean;
}

export function OutputsListEditor({
  outputs,
  onChange,
  readOnly,
  generatedByAI,
  compact: _compact,
}: OutputsListEditorProps) {
  // Remember the last config the user typed for each type, so toggling a type
  // off-then-on within a session restores their work without forcing a retype.
  // Seeded from the current outputs on mount.
  const lastConfigByType = useRef<Partial<Record<AgentOutputType, AgentOutput['config']>>>(
    Object.fromEntries(outputs.map((o) => [o.type, o.config])) as Partial<
      Record<AgentOutputType, AgentOutput['config']>
    >,
  );

  const byType: Partial<Record<AgentOutputType, AgentOutput>> = {};
  for (const o of outputs) byType[o.type] = o;

  const setEnabled = (type: AgentOutputType, enabled: boolean) => {
    if (readOnly) return;
    if (enabled) {
      // Restore last-known config for this type, else seed defaults.
      const config = lastConfigByType.current[type] ?? TYPE_META[type].defaultConfig();
      onChange([...outputs, { id: type, type, config }]);
    } else {
      // Snapshot current config so a re-toggle restores it.
      const current = byType[type];
      if (current) lastConfigByType.current[type] = current.config;
      onChange(outputs.filter((o) => o.type !== type));
    }
  };

  const updateConfig = (type: AgentOutputType, patch: AgentOutput['config']) => {
    if (readOnly) return;
    const next = outputs.map((o) =>
      o.type === type ? { ...o, config: { ...o.config, ...patch } } : o,
    );
    const updated = next.find((o) => o.type === type);
    if (updated) lastConfigByType.current[type] = updated.config;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {generatedByAI && outputs.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
          <Sparkles className="h-3 w-3" />
          AI-suggested
        </div>
      )}

      {ALL_TYPES.map((type) => {
        const meta = TYPE_META[type];
        const Icon = meta.icon;
        const current = byType[type];
        const enabled = current !== undefined;
        return (
          <div
            key={type}
            className={cn(
              'rounded-xl border transition-all',
              enabled
                ? 'border-border/50 bg-card'
                : 'border-border/30 bg-card/30',
            )}
          >
            <div className={cn('flex items-center gap-3 px-3 py-2.5', !enabled && 'opacity-60')}>
              <Icon className={cn('h-4 w-4 shrink-0', meta.iconTint)} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{meta.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {meta.description}
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => setEnabled(type, v)}
                disabled={readOnly}
                aria-label={`Toggle ${meta.label}`}
              />
            </div>
            {enabled && current && (
              <div className="border-t border-border/40 px-3 py-3 animate-in fade-in slide-in-from-top-1 duration-150">
                <OutputConfigEditor
                  output={current}
                  onConfigChange={(patch) => updateConfig(type, patch)}
                  readOnly={readOnly}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface OutputConfigEditorProps {
  output: AgentOutput;
  onConfigChange: (patch: AgentOutput['config']) => void;
  readOnly?: boolean;
}

function OutputConfigEditor({
  output,
  onConfigChange,
  readOnly,
}: OutputConfigEditorProps) {
  const cfg = output.config ?? {};

  if (output.type === 'briefing') {
    return (
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Template
        </Label>
        <Select
          value={cfg.template ?? 'exec'}
          onValueChange={(v) => onConfigChange({ template: v as 'exec' | 'analyst' | 'custom' })}
          disabled={readOnly}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exec">Executive (concise)</SelectItem>
            <SelectItem value="analyst">Analyst (detailed)</SelectItem>
            <SelectItem value="custom">Custom (uses Standards section)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (output.type === 'slides') {
    return (
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Audience
        </Label>
        <Input
          value={cfg.audience ?? ''}
          onChange={(e) => onConfigChange({ audience: e.target.value })}
          placeholder="e.g. execs, marketing team"
          disabled={readOnly}
          className="h-8 text-xs"
        />
      </div>
    );
  }

  if (output.type === 'email') {
    return <EmailConfigEditor config={cfg} onChange={onConfigChange} readOnly={readOnly} />;
  }

  if (output.type === 'data_export') {
    return (
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Format
        </Label>
        <Select
          value={cfg.export_format ?? 'csv'}
          onValueChange={(v) => onConfigChange({ export_format: v as 'csv' | 'json' })}
          disabled={readOnly}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="csv">CSV</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (output.type === 'post_examples') {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Number of posts
          </Label>
          <Input
            type="number"
            value={cfg.count ?? 6}
            onChange={(e) => onConfigChange({ count: parseInt(e.target.value) || 0 })}
            min={1}
            max={50}
            disabled={readOnly}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Selection criteria (optional)
          </Label>
          <Input
            value={cfg.criteria ?? ''}
            onChange={(e) => onConfigChange({ criteria: e.target.value })}
            placeholder="e.g. highest engagement, most controversial"
            disabled={readOnly}
            className="h-8 text-xs"
          />
        </div>
      </div>
    );
  }

  return null;
}

function EmailConfigEditor({
  config,
  onChange,
  readOnly,
}: {
  config: AgentOutput['config'];
  onChange: (patch: AgentOutput['config']) => void;
  readOnly?: boolean;
}) {
  const [emailInput, setEmailInput] = useState('');
  const recipients = config.recipients ?? [];

  const addEmail = () => {
    const trimmed = emailInput.trim();
    if (trimmed && !recipients.includes(trimmed)) {
      onChange({ recipients: [...recipients, trimmed] });
    }
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    onChange({ recipients: recipients.filter((e) => e !== email) });
  };

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Recipients
        </Label>
        <div className="flex gap-1.5">
          <Input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addEmail();
              }
            }}
            placeholder="Add email and press Enter"
            disabled={readOnly}
            className="h-8 flex-1 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={addEmail}
            disabled={readOnly}
          >
            Add
          </Button>
        </div>
        {recipients.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {recipients.map((email) => (
              <Badge key={email} variant="secondary" className="gap-1 text-[11px]">
                {email}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeEmail(email)}
                    aria-label={`Remove ${email}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Body
        </Label>
        <Select
          value={config.format ?? 'briefing'}
          onValueChange={(v) => onChange({ format: v as 'briefing' | 'summary' })}
          disabled={readOnly}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="briefing">Full briefing</SelectItem>
            <SelectItem value="summary">Short summary</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
