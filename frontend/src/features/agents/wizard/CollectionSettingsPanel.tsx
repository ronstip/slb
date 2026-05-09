import { useEffect, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { PLATFORMS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import { Input } from '../../../components/ui/input.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { MultiSelect, type MultiSelectOption } from '../../../components/ui/multi-select.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { listAgents, type Agent } from '../../../api/endpoints/agents.ts';
import type { CustomFieldDef, CustomFieldType } from '../../../api/types.ts';
import { cn } from '../../../lib/utils.ts';
import type { PlanStatus, WizardCollectionSettings } from './AgentCreationWizard.tsx';
import { AIThinkingCard } from './AIThinkingCard.tsx';

interface CollectionSettingsPanelProps {
  settings: WizardCollectionSettings;
  onChange: (settings: WizardCollectionSettings) => void;
  planStatus: PlanStatus;
  /** When true, render contents only — no outer card / step badge.
   *  Parent stepper provides those instead. */
  embedded?: boolean;
}

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

function agentLabel(a: Agent): string {
  const postCount = a.collection_ids?.length ?? 0;
  const suffix = postCount > 0 ? ` (${postCount} collection${postCount > 1 ? 's' : ''})` : '';
  return `${a.title}${suffix}`;
}

export function CollectionSettingsPanel({ settings, onChange, planStatus, embedded }: CollectionSettingsPanelProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then((list) => {
        if (cancelled) return;
        const withData = list.filter((a) => (a.collection_ids?.length ?? 0) > 0);
        setAvailableAgents(withData);
      })
      .catch(() => {
        if (!cancelled) setAvailableAgents([]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (partial: Partial<WizardCollectionSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const agentOptions: MultiSelectOption[] = availableAgents.map((a) => ({
    value: a.agent_id,
    label: agentLabel(a),
  }));

  const togglePlatform = (p: string) => {
    const next = settings.platforms.includes(p)
      ? settings.platforms.filter((x) => x !== p)
      : [...settings.platforms, p];
    update({ platforms: next });
  };

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !settings.keywords.includes(trimmed)) {
      update({ keywords: [...settings.keywords, trimmed] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    update({ keywords: settings.keywords.filter((k) => k !== kw) });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  const isInactive = planStatus === 'idle' || planStatus === 'clarifying';

  return (
    <div className={cn(
      'flex flex-col',
      !embedded && 'rounded-2xl border border-border bg-card p-6 shadow-sm',
      isInactive && !embedded && 'opacity-60',
    )}>
      {!embedded && (
        <>
          <div className="flex items-center gap-2.5 mb-4">
            <span className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
              isInactive ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground',
            )}>
              2
            </span>
            <h3 className="font-heading text-lg font-semibold tracking-tight">
              Data Settings
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4 -mt-2">
            Attach data from other agents, configure a new collection, or both.
          </p>
        </>
      )}

      {isInactive && (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-xs text-muted-foreground">
            Describe your agent in step 1,
            <br />
            then click <span className="font-medium text-primary">Continue</span>.
          </p>
        </div>
      )}

      {planStatus === 'planning' && (
        <div className="space-y-4 flex-1 pointer-events-none animate-pulse">
          <AIThinkingCard label="Planning collection" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2 flex-wrap">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <div className="flex gap-1.5">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      )}

      {(planStatus === 'ready' || planStatus === 'error') && (
      <div className="space-y-6 flex-1">
        {/* Existing collections picker — shown only when the user actually has
            other agents whose data they could attach. Hidden by default in
            the new-agent flow to keep the design cohesive with the demo. */}
        {!agentsLoading && availableAgents.length > 0 && settings.existingAgentIds.length > 0 && (
          <Section label="Attached agents" count={`${settings.existingAgentIds.length}`}>
            <MultiSelect
              value={settings.existingAgentIds}
              options={agentOptions}
              onChange={(ids) => update({ existingAgentIds: ids })}
              placeholder="Select agents to attach data from"
            />
          </Section>
        )}

        {settings.newCollectionEnabled && (
          <>
            {/* Platforms — every chip is a flat white pill with a subtle
                border + colored brand icon. Inactive chips are dimmed via
                opacity only so the row reads as a calm uniform set. */}
            <Section label="Platforms" count={`${settings.platforms.length} active`}>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const active = settings.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-[12.5px] font-medium text-foreground shadow-[0_1px_2px_rgba(27,24,21,0.04)] transition-opacity',
                        active ? 'opacity-100' : 'opacity-50 hover:opacity-80',
                      )}
                    >
                      <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                      {PLATFORM_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Keywords */}
            <Section label="Keywords" count={settings.keywords.length > 0 ? `${settings.keywords.length} active` : 'optional'}>
              <div className="flex flex-wrap items-center gap-1.5">
                {settings.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground shadow-sm"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      aria-label={`Remove ${kw}`}
                      className="inline-flex items-center text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <div className="relative inline-flex items-center">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="+ add keyword"
                    className="h-7 w-44 rounded-full border-dashed border-border bg-transparent px-3 text-[12px] shadow-none placeholder:text-muted-foreground/70 focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/20"
                  />
                </div>
              </div>
            </Section>

            {/* Time + Region — two rows side by side */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Section label="Time window">
                <div className="flex flex-wrap gap-1.5">
                  {TIME_RANGES.map(({ label, value }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update({ timeRangeDays: value })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                        settings.timeRangeDays === value
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Section>

              <Section label="Region">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: 'global', l: 'Global' },
                    { v: 'NA',     l: 'North America' },
                    { v: 'EU',     l: 'Europe' },
                    { v: 'LATAM',  l: 'LATAM' },
                    { v: 'APAC',   l: 'APAC' },
                  ].map(({ v, l }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => update({ geoScope: v })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                        settings.geoScope === v
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Section>
            </div>

            {/* Max posts — two-tone track that fills primary up to the
                thumb position. The fill % is fed via a CSS custom prop so
                the WebKit gradient stop tracks the value. */}
            <Section label="Max posts per run">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={100}
                  max={5000}
                  step={100}
                  value={settings.nPosts}
                  onChange={(e) => update({ nPosts: parseInt(e.target.value) || 0 })}
                  className="range-slider flex-1"
                  style={{
                    ['--range-fill' as string]: `${((settings.nPosts - 100) / (5000 - 100)) * 100}%`,
                  }}
                />
                <span className="min-w-[4.5rem] text-right font-heading text-sm font-semibold tabular-nums text-foreground">
                  {settings.nPosts.toLocaleString()}
                </span>
              </div>
            </Section>
          </>
        )}

        {/* Relevance filter — flat textarea (no collapsible chrome, mirrors design). */}
        <Section
          label="Relevance filter"
          hint={settings.enrichmentFromAI ? 'AI' : undefined}
        >
          <Textarea
            value={settings.enrichmentContext}
            onChange={(e) =>
              update({ enrichmentContext: e.target.value, enrichmentFromAI: false })
            }
            placeholder="Describe what counts as relevant — and what doesn't."
            className="min-h-[110px] resize-none rounded-xl border-border bg-background text-[13px] leading-relaxed shadow-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Section>

        {/* Custom field chips — quick-add presets, plus per-field details. */}
        <Section label="Custom fields" hint="optional">
          <CustomFieldChips
            fields={settings.customFields}
            onChange={(next) =>
              update({ customFields: next, enrichmentFromAI: false })
            }
          />
        </Section>
      </div>
      )}
    </div>
  );
}

// ── Custom-field chip row ──
//
// Quick-add chips for the two most common enrichment fields, plus a
// "+ Custom column…" chip that lets the user define an ad-hoc string field.
// Each currently-active field renders as a removable pill.
const PRESET_FIELDS: { name: string; label: string; type: CustomFieldType; description: string }[] = [
  {
    name: 'sentiment_score',
    label: 'Sentiment score',
    type: 'float',
    description: 'A −1.0 to 1.0 score, where −1.0 is strongly negative and 1.0 is strongly positive.',
  },
  {
    name: 'author_follower_count',
    label: 'Author follower count',
    type: 'int',
    description: 'Approximate follower count of the post author at the time of publication.',
  },
];

function CustomFieldChips({
  fields,
  onChange,
}: {
  fields: CustomFieldDef[];
  onChange: (next: CustomFieldDef[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const addPreset = (preset: typeof PRESET_FIELDS[number]) => {
    if (fields.some((f) => f.name === preset.name)) return;
    onChange([...fields, { name: preset.name, description: preset.description, type: preset.type }]);
  };

  const removeField = (name: string) => {
    onChange(fields.filter((f) => f.name !== name));
  };

  const commitCustom = () => {
    const trimmed = draft.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (trimmed && !fields.some((f) => f.name === trimmed)) {
      onChange([...fields, { name: trimmed, description: draft.trim(), type: 'str' as CustomFieldType }]);
    }
    setDraft('');
    setAdding(false);
  };

  const labelFor = (f: CustomFieldDef): string => {
    const preset = PRESET_FIELDS.find((p) => p.name === f.name);
    if (preset) return preset.label;
    return f.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Active fields — solid filled chip in primary so they read as "added". */}
      {fields.map((f) => (
        <span
          key={f.name}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[12.5px] font-medium text-primary"
        >
          {labelFor(f)}
          <button
            type="button"
            onClick={() => removeField(f.name)}
            aria-label={`Remove ${labelFor(f)}`}
            className="inline-flex items-center text-primary/70 transition-colors hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {/* Preset add chips for any fields not yet active. Dashed border, plus icon. */}
      {PRESET_FIELDS.filter((p) => !fields.some((f) => f.name === p.name)).map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => addPreset(p)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/40 bg-transparent px-3.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          {p.label}
        </button>
      ))}
      {/* Free-form custom-column add. */}
      {adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitCustom();
            } else if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="Field name"
          className="h-8 w-48 rounded-full border-dashed border-muted-foreground/40 bg-transparent px-3.5 text-[12.5px] shadow-none focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/20"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/40 bg-transparent px-3.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          Custom column…
        </button>
      )}
    </div>
  );
}

// ── Section header (small uppercase label + optional count) ──
function Section({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{label}</span>
        {count && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/80">{count}</span>
          </>
        )}
        {hint && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/60 normal-case tracking-normal italic">{hint}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
