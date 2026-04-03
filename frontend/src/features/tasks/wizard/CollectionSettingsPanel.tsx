import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
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
import { cn } from '../../../lib/utils.ts';
import type { WizardCollectionSettings } from './TaskCreationWizard.tsx';

interface CollectionSettingsPanelProps {
  settings: WizardCollectionSettings;
  onChange: (settings: WizardCollectionSettings) => void;
}

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

export function CollectionSettingsPanel({ settings, onChange }: CollectionSettingsPanelProps) {
  const [keywordInput, setKeywordInput] = useState('');

  const update = (partial: Partial<WizardCollectionSettings>) => {
    onChange({ ...settings, ...partial });
  };

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

      <div className="space-y-4 flex-1">
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
      </div>
    </div>
  );
}
