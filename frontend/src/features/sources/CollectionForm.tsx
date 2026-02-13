import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { CollectionConfig, CreateCollectionRequest } from '../../api/types.ts';
import { createCollection } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { PLATFORMS, PLATFORM_LABELS } from '../../lib/constants.ts';

interface CollectionFormProps {
  prefill?: CollectionConfig;
  onClose: () => void;
}

const TIME_RANGES = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

const MAX_POSTS_OPTIONS = [5, 50, 500, 1000, 2000, 5000];

export function CollectionForm({ prefill, onClose }: CollectionFormProps) {
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
  const [maxPosts, setMaxPosts] = useState(prefill?.max_posts_per_platform || 5);
  const [includeComments, setIncludeComments] = useState(prefill?.include_comments ?? true);
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async () => {
    if (platforms.length === 0) return;
    setSubmitting(true);

    try {
      const req: CreateCollectionRequest = {
        description,
        platforms,
        keywords,
        channel_urls: channelUrls.length > 0 ? channelUrls : undefined,
        time_range_days: timeRangeDays,
        geo_scope: geoScope,
        max_posts_per_platform: maxPosts,
        include_comments: includeComments,
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
          max_posts_per_platform: maxPosts,
          include_comments: includeComments,
          geo_scope: geoScope,
        },
        title: description || keywords.join(', ') || 'New Collection',
        postsCollected: 0,
        postsEnriched: 0,
        postsEmbedded: 0,
        selected: true,
        createdAt: new Date().toISOString(),
      });

      const platformNames = platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
      addSystemMessage(
        `Collection started: ${description || keywords.join(', ')} on ${platformNames} — ${keywords.length} keywords, last ${timeRangeDays} days.`,
      );

      onClose();
    } catch (err) {
      console.error('Failed to create collection:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
      {/* Description */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this collection is about..."
          rows={2}
          className="w-full rounded-xl border border-border-default/60 bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent/50"
        />
      </div>

      {/* Platforms */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Platforms</label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                platforms.includes(p)
                  ? 'bg-accent text-white shadow-sm'
                  : 'border border-border-default/60 bg-bg-surface text-text-secondary hover:border-accent/40 hover:text-accent'
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Keywords */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-secondary">Keywords</label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border-default/60 bg-bg-surface px-3 py-2 focus-within:border-accent/50">
          {keywords.map((kw) => (
            <span
              key={kw}
              className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-0.5 text-xs text-accent"
            >
              {kw}
              <button onClick={() => setKeywords(keywords.filter((k) => k !== kw))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={handleKeywordKeyDown}
            onBlur={addKeyword}
            placeholder={keywords.length === 0 ? 'Type + Enter to add' : ''}
            className="min-w-[100px] flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
      </div>

      {/* Channel URLs */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Channel URLs <span className="text-text-tertiary">(optional)</span>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border-default/60 bg-bg-surface px-3 py-2 focus-within:border-accent/50">
          {channelUrls.map((url) => (
            <span
              key={url}
              className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-0.5 text-xs text-accent"
            >
              {url.length > 30 ? url.slice(0, 30) + '...' : url}
              <button onClick={() => setChannelUrls(channelUrls.filter((u) => u !== url))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyDown={handleChannelKeyDown}
            onBlur={addChannel}
            placeholder={channelUrls.length === 0 ? 'Paste URL + Enter' : ''}
            className="min-w-[100px] flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
      </div>

      {/* Time Range */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Time Range</label>
        <div className="flex flex-wrap gap-2">
          {TIME_RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setTimeRangeDays(value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                timeRangeDays === value
                  ? 'bg-accent text-white shadow-sm'
                  : 'border border-border-default/60 bg-bg-surface text-text-secondary hover:border-accent/40'
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
          <label className="mb-1 block text-xs font-medium text-text-secondary">Region</label>
          <select
            value={geoScope}
            onChange={(e) => setGeoScope(e.target.value)}
            className="w-full rounded-xl border border-border-default/60 bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
          >
            <option value="global">Global</option>
            <option value="US">US</option>
            <option value="EU">EU</option>
            <option value="UK">UK</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Max Posts / Platform</label>
          <select
            value={maxPosts}
            onChange={(e) => setMaxPosts(Number(e.target.value))}
            className="w-full rounded-xl border border-border-default/60 bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
          >
            {MAX_POSTS_OPTIONS.map((n) => (
              <option key={n} value={n}>{n.toLocaleString()}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Include Comments */}
      <div className="mb-6">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeComments}
            onChange={(e) => setIncludeComments(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-primary">Include Comments</span>
        </label>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 border-t border-border-default/50 pt-4">
        <button
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-surface-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={platforms.length === 0 || submitting}
          className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? 'Starting...' : 'Start Collection'}
        </button>
      </div>
    </div>
  );
}
