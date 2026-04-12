import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { CollectionConfig, CreateCollectionRequest } from '../../api/types.ts';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { createCollection } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { PLATFORMS, PLATFORM_LABELS } from '../../lib/constants.ts';
import { Button } from '../../components/ui/button.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Input } from '../../components/ui/input.tsx';
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
  onUpdate?: (config: CollectionConfig) => void;
}

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];


export function CollectionForm({ prefill, onClose, variant = 'modal', onSubmitStart, onSubmitSuccess, onSubmitError, suppressSystemMessage, onUpdate }: CollectionFormProps) {
  const inline = variant === 'inline';
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
  const [nPosts, setNPosts] = useState(prefill?.n_posts ?? 0);
  const [includeComments, setIncludeComments] = useState(prefill?.include_comments ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSource = useSourcesStore((s) => s.addSource);
  const addSystemMessage = useChatStore((s) => s.addSystemMessage);

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

  const buildConfig = (): CollectionConfig => ({
    platforms,
    keywords,
    channel_urls: channelUrls,
    time_range: {
      start: new Date(Date.now() - timeRangeDays * 86_400_000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0],
    },
    n_posts: nPosts,
    include_comments: includeComments,
    geo_scope: geoScope,
  });

  const handleUpdate = () => {
    onUpdate?.(buildConfig());
    onClose();
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
        n_posts: nPosts,
        include_comments: includeComments,
      };

      const result = await createCollection(req);

      addSource({
        collectionId: result.collection_id,
        status: 'running',
        config: {
          platforms,
          keywords,
          channel_urls: channelUrls,
          time_range: {
            start: new Date(Date.now() - timeRangeDays * 86_400_000).toISOString().split('T')[0],
            end: new Date().toISOString().split('T')[0],
          },
          n_posts: nPosts,
          include_comments: includeComments,
          geo_scope: geoScope,
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
    <div className={`overflow-y-auto ${inline ? 'px-3 py-2.5' : 'px-6 py-4 max-h-[70vh]'}`}>

      {/* Description */}
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
        <Label className="mb-1.5">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this collection is about..."
          rows={2}
        />
      </div>

      {/* Platforms */}
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
        <Label className="mb-1.5">Platforms</Label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                platforms.includes(p)
                  ? 'bg-foreground text-background shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground'
              }`}
            >
              <PlatformIcon platform={p} className={`h-3.5 w-3.5 ${platforms.includes(p) ? 'brightness-0 invert dark:brightness-100 dark:invert-0' : ''}`} />
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Keywords */}
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
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
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
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
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
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
      <div className={`grid grid-cols-2 gap-4 ${inline ? 'mb-2.5' : 'mb-4'}`}>
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
          <Label className="mb-1.5">Total Posts (0 = all)</Label>
          <Input
            type="number"
            min={0}
            value={nPosts}
            onChange={(e) => setNPosts(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
      </div>

      {/* Include Comments */}
      <div className={inline ? 'mb-2.5' : 'mb-4'}>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeComments}
            onCheckedChange={(checked) => setIncludeComments(checked === true)}
          />
          <span className="text-sm text-foreground">Include Comments</span>
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Footer */}
      <div className={`flex items-center justify-end gap-2 border-t border-border ${inline ? 'pt-2.5' : 'pt-4'}`}>
        <Button variant="ghost" size={inline ? 'sm' : 'default'} onClick={onClose}>
          {inline ? 'Dismiss' : 'Cancel'}
        </Button>
        {onUpdate && (
          <Button
            variant="outline"
            size={inline ? 'sm' : 'default'}
            onClick={handleUpdate}
            disabled={platforms.length === 0}
          >
            Update
          </Button>
        )}
        <Button
          size={inline ? 'sm' : 'default'}
          onClick={handleSubmit}
          disabled={platforms.length === 0 || submitting}
        >
          {submitting ? 'Starting...' : 'Start Collection'}
        </Button>
      </div>
    </div>
  );
}
