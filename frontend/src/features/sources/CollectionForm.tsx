import { useState, type KeyboardEvent } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { CollectionConfig, CreateCollectionRequest } from '../../api/types.ts';
import { createCollection } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { PLATFORMS, PLATFORM_LABELS, SCHEDULE_UTC_TIMES, parseScheduleString, buildScheduleString, type ScheduleUnit } from '../../lib/constants.ts';
import { Button } from '../../components/ui/button.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';

export interface CollectionFormSummary {
  keywords: string[];
  platforms: string[];
  description: string;
}

interface CollectionFormProps {
  prefill?: CollectionConfig;
  onClose: () => void;
  variant?: 'modal' | 'inline';
  onSubmitStart?: () => void;
  onSubmitSuccess?: (collectionId: string, summary?: CollectionFormSummary) => void;
  onSubmitError?: () => void;
  suppressSystemMessage?: boolean;
}

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];


export function CollectionForm({ prefill, onClose, variant = 'modal', onSubmitStart, onSubmitSuccess, onSubmitError, suppressSystemMessage }: CollectionFormProps) {
  const [description, setDescription] = useState(prefill?.keywords?.join(', ') || '');
  const [platforms, setPlatforms] = useState<string[]>(prefill?.platforms || ['instagram', 'tiktok']);
  const [keywords, setKeywords] = useState<string[]>(prefill?.keywords || []);
  const [keywordInput, setKeywordInput] = useState('');
  const [channelUrls, setChannelUrls] = useState<string[]>(prefill?.channel_urls || []);
  const [channelInput, setChannelInput] = useState('');
  const [timeRangeDays, setTimeRangeDays] = useState(
    prefill?.time_range
      ? Math.round((new Date(prefill.time_range.end).getTime() - new Date(prefill.time_range.start).getTime()) / 86_400_000)
      : 90,
  );
  const [geoScope, setGeoScope] = useState(prefill?.geo_scope || 'global');
  const [maxPostsPerKeyword, setMaxPostsPerKeyword] = useState(prefill?.max_posts_per_keyword ?? 20);
  const [includeComments, setIncludeComments] = useState(prefill?.include_comments ?? true);
  const [ongoing, setOngoing] = useState(prefill?.ongoing ?? false);

  const parsed = parseScheduleString(prefill?.schedule);
  const [scheduleUnit, setScheduleUnit] = useState<ScheduleUnit>(parsed.unit);
  const [scheduleInterval, setScheduleInterval] = useState(parsed.interval);
  const [scheduleTimeUtc, setScheduleTimeUtc] = useState(parsed.time);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSource = useSourcesStore((s) => s.addSource);
  const addSystemMessage = useChatStore((s) => s.addSystemMessage);

  const scheduleStr = buildScheduleString(scheduleUnit, scheduleInterval, scheduleTimeUtc);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
    }
    setKeywordInput('');
  };

  const addChannel = () => {
    const trimmed = channelInput.trim();
    if (trimmed && !channelUrls.includes(trimmed)) {
      setChannelUrls([...channelUrls, trimmed]);
    }
    setChannelInput('');
  };

  const handleKeywordKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addKeyword(); }
    if (e.key === 'Backspace' && !keywordInput && keywords.length > 0) {
      setKeywords(keywords.slice(0, -1));
    }
  };

  const handleChannelKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addChannel(); }
    if (e.key === 'Backspace' && !channelInput && channelUrls.length > 0) {
      setChannelUrls(channelUrls.slice(0, -1));
    }
  };

  const handleSubmit = async () => {
    if (platforms.length === 0) return;
    setSubmitting(true);
    setError(null);
    onSubmitStart?.();

    try {
      const req: CreateCollectionRequest = {
        description,
        platforms,
        keywords,
        channel_urls: channelUrls.length > 0 ? channelUrls : undefined,
        time_range_days: timeRangeDays,
        geo_scope: geoScope,
        max_posts_per_keyword: maxPostsPerKeyword,
        include_comments: includeComments,
        ongoing,
        schedule: ongoing ? scheduleStr : undefined,
      };

      const result = await createCollection(req);

      addSource({
        collectionId: result.collection_id,
        status: 'pending',
        config: {
          platforms,
          keywords,
          channel_urls: channelUrls,
          time_range: {
            start: new Date(Date.now() - timeRangeDays * 86_400_000).toISOString().split('T')[0],
            end: new Date().toISOString().split('T')[0],
          },
          max_posts_per_keyword: maxPostsPerKeyword,
          include_comments: includeComments,
          geo_scope: geoScope,
          ongoing,
          schedule: ongoing ? scheduleStr : undefined,
        },
        title: description || keywords.join(', ') || 'New Collection',
        postsCollected: 0,
        totalViews: 0,
        positivePct: null,
        selected: true,
        active: true,
        createdAt: new Date().toISOString(),
      });

      if (!suppressSystemMessage) {
        const platformNames = platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
        addSystemMessage(
          `Collection started: ${description || keywords.join(', ')} on ${platformNames} — ${keywords.length} keywords, last ${timeRangeDays === 1 ? '24 hours' : `${timeRangeDays} days`}.`,
        );
      }

      onClose();
      onSubmitSuccess?.(result.collection_id, { keywords, platforms, description });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create collection';
      setError(message);
      onSubmitError?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`overflow-y-auto px-6 py-4 ${variant === 'modal' ? 'max-h-[70vh]' : ''}`}>

      {/* Description */}
      <div className="mb-4">
        <Label className="mb-1.5">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this collection is about..."
          rows={2}
        />
      </div>

      {/* Platforms */}
      <div className="mb-4">
        <Label className="mb-1.5">Platforms</Label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                platforms.includes(p)
                  ? 'bg-foreground text-background shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground'
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Keywords */}
      <div className="mb-4">
        <Label className="mb-1.5">Keywords</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-2 focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring">
          {keywords.map((kw) => (
            <Badge key={kw} variant="secondary" className="gap-1 bg-foreground/10 text-foreground">
              {kw}
              <button onClick={() => setKeywords(keywords.filter((k) => k !== kw))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={handleKeywordKeyDown}
            onBlur={addKeyword}
            placeholder={keywords.length === 0 ? 'Type + Enter to add' : ''}
            className="min-w-[100px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Channel URLs */}
      <div className="mb-4">
        <Label className="mb-1.5">
          Channel URLs <span className="text-muted-foreground">(optional)</span>
        </Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-2 focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring">
          {channelUrls.map((url) => (
            <Badge key={url} variant="secondary" className="gap-1 bg-foreground/10 text-foreground">
              {url.length > 30 ? url.slice(0, 30) + '...' : url}
              <button onClick={() => setChannelUrls(channelUrls.filter((u) => u !== url))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyDown={handleChannelKeyDown}
            onBlur={addChannel}
            placeholder={channelUrls.length === 0 ? 'Paste URL + Enter' : ''}
            className="min-w-[100px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Time Range */}
      <div className="mb-4">
        <Label className="mb-1.5">Time Range</Label>
        <div className="flex flex-wrap gap-2">
          {TIME_RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setTimeRangeDays(value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                timeRangeDays === value
                  ? 'bg-foreground text-background shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:border-foreground/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Region + Max Posts row */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <Label className="mb-1.5">Region</Label>
          <Select value={geoScope} onValueChange={setGeoScope}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="US">US</SelectItem>
              <SelectItem value="EU">EU</SelectItem>
              <SelectItem value="UK">UK</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5">Posts / Keyword</Label>
          <Input
            type="number"
            min={1}
            value={maxPostsPerKeyword}
            onChange={(e) => setMaxPostsPerKeyword(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      </div>

      {/* Include Comments */}
      <div className="mb-4">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeComments}
            onCheckedChange={(checked) => setIncludeComments(checked === true)}
          />
          <span className="text-sm text-foreground">Include Comments</span>
        </label>
      </div>

      {/* Ongoing Monitoring */}
      <div className={`mb-5 rounded-lg border px-4 py-3 transition-colors ${ongoing ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/30'}`}>
        <div className="flex items-center gap-3">
          <Switch checked={ongoing} onCheckedChange={setOngoing} />
          <div className="flex items-center gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${ongoing ? 'text-emerald-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${ongoing ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
              Ongoing Monitoring
            </span>
          </div>
        </div>
        {ongoing && (
          <div className="mt-3">
            <Label className="mb-2 text-xs text-muted-foreground">Refresh schedule</Label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Every</span>
              <input
                type="number"
                min={1}
                max={scheduleUnit === 'minute' ? 1440 : scheduleUnit === 'hour' ? 168 : 90}
                value={scheduleInterval}
                onChange={(e) => setScheduleInterval(Math.max(1, Number(e.target.value) || 1))}
                className="w-14 rounded border border-input bg-card px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Select value={scheduleUnit} onValueChange={(v) => setScheduleUnit(v as ScheduleUnit)}>
                <SelectTrigger className="w-24 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minute">{scheduleInterval === 1 ? 'minute' : 'minutes'}</SelectItem>
                  <SelectItem value="hour">{scheduleInterval === 1 ? 'hour' : 'hours'}</SelectItem>
                  <SelectItem value="day">{scheduleInterval === 1 ? 'day' : 'days'}</SelectItem>
                </SelectContent>
              </Select>
              {scheduleUnit === 'day' && (
                <>
                  <span className="text-muted-foreground">at</span>
                  <Select value={scheduleTimeUtc} onValueChange={setScheduleTimeUtc}>
                    <SelectTrigger className="w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_UTC_TIMES.map(({ label, value }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">UTC</span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Time range above sets the initial backfill window. Subsequent runs collect only new posts.
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose}>
          {variant === 'inline' ? 'Dismiss' : 'Cancel'}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={platforms.length === 0 || submitting}
        >
          {submitting ? 'Starting...' : 'Start Collection'}
        </Button>
      </div>
    </div>
  );
}
