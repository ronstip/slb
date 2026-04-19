import { useState, useRef, useEffect } from 'react';
import { Play, Edit2, ChevronDown, ChevronUp, Search, Loader2 } from 'lucide-react';
import type { DesignResearchResult, CreateCollectionRequest, CollectionConfig } from '../../../api/types.ts';
import { PLATFORM_LABELS } from '../../../lib/constants.ts';
import { createCollection } from '../../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { CollectionForm } from '../../sources/CollectionForm.tsx';
import { CollectionProgressCard } from './CollectionProgressCard.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';

interface ResearchDesignCardProps {
  data: DesignResearchResult;
  onCollectionStarted?: (message: string) => void;
}

export function ResearchDesignCard({ data, onCollectionStarted }: ResearchDesignCardProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localConfig, setLocalConfig] = useState<CollectionConfig>(data.config);
  const formContainerRef = useRef<HTMLDivElement>(null);

  const handleUpdate = (config: CollectionConfig) => {
    setLocalConfig(config);
    setFormVisible(false);
  };

  const addSource = useSourcesStore((s) => s.addSource);

  const submitted = submitting || !!collectionId;

  const timeRangeDays = Math.max(1, Math.round(
    (new Date(localConfig.time_range.end).getTime() - new Date(localConfig.time_range.start).getTime()) / 86_400_000,
  ));
  const timeRangeLabel = timeRangeDays === 1 ? '24 hours'
    : timeRangeDays <= 7 ? `${timeRangeDays} days`
    : timeRangeDays <= 30 ? `${Math.round(timeRangeDays / 7)} weeks`
    : timeRangeDays <= 365 ? `${Math.round(timeRangeDays / 30)} months`
    : `${Math.round(timeRangeDays / 365)} years`;

  const handleDirectStart = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const cfg = localConfig;
      const timeRangeDays = Math.max(1, Math.round(
        (new Date(cfg.time_range.end).getTime() - new Date(cfg.time_range.start).getTime()) / 86_400_000,
      ));
      const req: CreateCollectionRequest = {
        description: cfg.keywords.join(', '),
        platforms: cfg.platforms,
        keywords: cfg.keywords,
        channel_urls: cfg.channel_urls?.length ? cfg.channel_urls : undefined,
        time_range_days: timeRangeDays,
        geo_scope: cfg.geo_scope,
        n_posts: cfg.n_posts ?? 0,
        include_comments: cfg.include_comments,
        custom_fields: cfg.custom_fields,
        video_params: cfg.video_params,
        reasoning_level: cfg.reasoning_level,
        min_likes: cfg.min_likes,
      };
      const result = await createCollection(req);
      setCollectionId(result.collection_id);
      addSource({
        collectionId: result.collection_id,
        status: 'running',
        config: cfg,
        title: cfg.keywords.join(', ') || 'New Collection',
        postsCollected: 0,
        totalViews: 0,
        positivePct: null,
        selected: true,
        active: true,
        createdAt: new Date().toISOString(),
      });
      const platformNames = cfg.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
      const keywords = cfg.keywords.join(', ');
      onCollectionStarted?.(
        `Collection just started for "${keywords}" on ${platformNames}. Collection ID: ${result.collection_id}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start collection';
      setError(message);
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (formVisible && formContainerRef.current) {
      requestAnimationFrame(() => {
        formContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [formVisible]);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-accent-vibrant/20 bg-gradient-to-b from-accent-vibrant/5 to-background shadow-sm">
      {/* ── Header row ── */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-vibrant/10">
          <Search className="h-3.5 w-3.5 text-accent-vibrant" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h4 className="shrink-0 font-heading text-[13px] font-semibold tracking-tight text-foreground">Research Design</h4>

          <div className="flex items-center gap-1.5">
            {localConfig.platforms.map((p) => (
              <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5" />
            ))}
          </div>

          <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
            {data.summary.estimated_posts} posts · {timeRangeLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {!formVisible && !submitted && (
            <>
              <button
                onClick={() => setFormVisible(true)}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Edit2 className="h-3 w-3" />
                Edit
              </button>
              <button
                onClick={handleDirectStart}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Play className="h-3 w-3" />
                Start
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Collapsable config details ── */}
      {detailsOpen && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          {localConfig.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground/60 mr-1">Keywords</span>
              {localConfig.keywords.map((kw) => (
                <Badge key={kw} variant="outline" className="text-[11px] font-normal text-muted-foreground">
                  {kw}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {localConfig.platforms.map((p) => (
              <span key={p} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <PlatformIcon platform={p} className="h-3 w-3" />
                {PLATFORM_LABELS[p] || p}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-md bg-muted/40 px-2.5 py-1.5">
            <div>
              <p className="text-[10px] text-muted-foreground/60">Time range</p>
              <p className="text-[12px] font-medium text-foreground">{timeRangeLabel}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/60">Est. posts</p>
              <p className="text-[12px] font-medium text-foreground">{data.summary.estimated_posts}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/60">Est. time</p>
              <p className="text-[12px] font-medium text-foreground">~{data.summary.estimated_time_minutes} min</p>
            </div>
          </div>

          {localConfig.custom_fields && localConfig.custom_fields.length > 0 && (
            <div>
              <span className="text-[11px] text-muted-foreground/60">Custom enrichment</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {localConfig.custom_fields!.map((f) => (
                  <Badge key={f.name} variant="outline" className="text-[11px] font-normal text-muted-foreground" title={f.description}>
                    {f.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="border-t border-border/30 px-5 py-2.5">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            {error}
          </div>
        </div>
      )}

      {/* ── Inline edit form ── */}
      {formVisible && !submitted && (
        <div ref={formContainerRef} className="border-t border-border/30">
          <CollectionForm
            prefill={localConfig}
            onClose={() => setFormVisible(false)}
            variant="inline"
            suppressSystemMessage
            onUpdate={handleUpdate}
            onSubmitStart={() => {
              setFormVisible(false);
              setSubmitting(true);
              setError(null);
            }}
            onSubmitSuccess={(id, summary) => {
              setCollectionId(id);
              setSubmitting(false);
              if (summary && onCollectionStarted) {
                const platformNames = summary.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
                const kw = summary.keywords.join(', ');
                onCollectionStarted(
                  `Collection just started for "${kw}" on ${platformNames}. Collection ID: ${id}.`,
                );
              }
            }}
            onSubmitError={() => {
              setSubmitting(false);
              setFormVisible(true);
            }}
          />
        </div>
      )}

      {/* ── Live collection stats ── */}
      {submitted && collectionId && (
        <CollectionProgressCard collectionId={collectionId} variant="inline" onCompleted={onCollectionStarted} />
      )}
      {submitted && !collectionId && (
        <div className="border-t border-border/30 px-5 py-2.5 flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-vibrant" />
          <span className="text-[13px] font-medium text-foreground">Creating collection…</span>
        </div>
      )}
    </div>
  );
}
