import { useEffect, useState, type KeyboardEvent } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { PLATFORMS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { MultiSelect, type MultiSelectOption } from '../../../components/ui/multi-select.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { listCollections } from '../../../api/endpoints/collections.ts';
import type { CollectionStatusResponse } from '../../../api/types.ts';
import { cn } from '../../../lib/utils.ts';
import type { PlanStatus, WizardCollectionSettings } from './AgentCreationWizard.tsx';
import { AIThinkingCard } from './AIThinkingCard.tsx';
import { EnrichmentEditor } from './EnrichmentEditor.tsx';

interface CollectionSettingsPanelProps {
  settings: WizardCollectionSettings;
  onChange: (settings: WizardCollectionSettings) => void;
  planStatus: PlanStatus;
}

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

function collectionLabel(c: CollectionStatusResponse): string {
  const kw = c.config?.keywords?.[0];
  const plats = c.config?.platforms?.slice(0, 2).join('/');
  if (kw && plats) return `${kw} — ${plats}`;
  if (kw) return kw;
  if (plats) return plats;
  return c.collection_id.slice(0, 8);
}

export function CollectionSettingsPanel({ settings, onChange, planStatus }: CollectionSettingsPanelProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [availableCollections, setAvailableCollections] = useState<CollectionStatusResponse[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listCollections()
      .then((list) => {
        if (cancelled) return;
        const ready = list.filter((c) => c.status === 'ready' || c.posts_collected > 0);
        setAvailableCollections(ready);
      })
      .catch(() => {
        if (!cancelled) setAvailableCollections([]);
      })
      .finally(() => {
        if (!cancelled) setCollectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (partial: Partial<WizardCollectionSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const collectionOptions: MultiSelectOption[] = availableCollections.map((c) => ({
    value: c.collection_id,
    label: collectionLabel(c),
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

  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          2
        </span>
        <h3 className="text-lg font-semibold text-foreground tracking-tight">
          Collection Settings
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 -mt-2">
        Attach existing collections, configure a new one, or both.
      </p>

      {(planStatus === 'idle' || planStatus === 'clarifying') && (
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
      <div className="space-y-4 flex-1">
        {/* Existing collections picker */}
        {(collectionsLoading || availableCollections.length > 0) && (
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">
              Use existing collections <span className="text-muted-foreground/50">(optional)</span>
            </Label>
            <MultiSelect
              value={settings.existingCollectionIds}
              options={collectionOptions}
              onChange={(ids) => update({ existingCollectionIds: ids })}
              placeholder={collectionsLoading ? 'Loading…' : 'Select collections to attach'}
            />
          </div>
        )}

        {/* Toggle for new collection block */}
        <button
          type="button"
          onClick={() => update({ newCollectionEnabled: !settings.newCollectionEnabled })}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {settings.newCollectionEnabled ? (
            <>
              <Minus className="h-3.5 w-3.5" />
              Remove new collection
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Configure a new collection
            </>
          )}
        </button>

        {settings.newCollectionEnabled && (
          <>
        {/* Platforms */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Platforms</Label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                  settings.platforms.includes(p)
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/50 text-muted-foreground hover:border-border',
                )}
              >
                <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Keywords */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">
            Keywords <span className="text-muted-foreground/50">(optional)</span>
          </Label>
          <div className="flex gap-2">
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add keyword and press Enter"
              className="text-sm h-8"
            />
          </div>
          {settings.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {settings.keywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="gap-1 text-xs">
                  {kw}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-destructive"
                    onClick={() => removeKeyword(kw)}
                  />
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Time Range */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Time Range</Label>
          <div className="flex flex-wrap gap-1.5">
            {TIME_RANGES.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ timeRangeDays: value })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                  settings.timeRangeDays === value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/50 text-muted-foreground hover:border-border',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Geo + Posts row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">Region</Label>
            <Select value={settings.geoScope} onValueChange={(v) => update({ geoScope: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="US">United States</SelectItem>
                <SelectItem value="UK">United Kingdom</SelectItem>
                <SelectItem value="EU">Europe</SelectItem>
                <SelectItem value="APAC">Asia-Pacific</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">Max Posts</Label>
            <Input
              type="number"
              value={settings.nPosts || ''}
              onChange={(e) => update({ nPosts: parseInt(e.target.value) || 0 })}
              placeholder="500"
              className="text-sm h-8"
              min={0}
              step={100}
            />
          </div>
        </div>
          </>
        )}

        <EnrichmentEditor
          context={settings.enrichmentContext}
          onContextChange={(v) =>
            update({ enrichmentContext: v, enrichmentFromAI: false })
          }
          customFields={settings.customFields}
          onCustomFieldsChange={(fields) =>
            update({ customFields: fields, enrichmentFromAI: false })
          }
          generatedByAI={settings.enrichmentFromAI}
        />
      </div>
      )}
    </div>
  );
}
