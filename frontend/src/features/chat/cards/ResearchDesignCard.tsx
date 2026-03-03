import { useState, useRef, useEffect } from 'react';
import { Play, Edit2, CheckCircle2, ChevronDown, ChevronUp, Search, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { DesignResearchResult, CreateCollectionRequest } from '../../../api/types.ts';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '../../../lib/constants.ts';
import { formatNumber } from '../../../lib/format.ts';
import { createCollection, getCollectionStatus } from '../../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { CollectionForm } from '../../sources/CollectionForm.tsx';
import { Badge } from '../../../components/ui/badge.tsx';

interface ResearchDesignCardProps {
  data: DesignResearchResult;
}

export function ResearchDesignCard({ data }: ResearchDesignCardProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);
  const formContainerRef = useRef<HTMLDivElement>(null);

  const addSource = useSourcesStore((s) => s.addSource);
  const addSystemMessage = useChatStore((s) => s.addSystemMessage);

  const submitted = submitting || !!collectionId;

  const handleDirectStart = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const cfg = data.config;
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
        max_calls: cfg.max_calls,
        include_comments: cfg.include_comments,
        ongoing: cfg.ongoing,
        schedule: cfg.schedule,
      };
      const result = await createCollection(req);
      setCollectionId(result.collection_id);
      addSource({
        collectionId: result.collection_id,
        status: 'pending',
        config: cfg,
        title: cfg.keywords.join(', ') || 'New Collection',
        postsCollected: 0,
        postsEnriched: 0,
        postsEmbedded: 0,
        selected: true,
        active: true,
        createdAt: new Date().toISOString(),
      });
      const platformNames = cfg.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
      addSystemMessage(
        `Collection started: ${cfg.keywords.join(', ')} on ${platformNames}.`,
      );
    } catch {
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

  // Collapse details after submission starts
  useEffect(() => {
    if (submitted) setDetailsOpen(false);
  }, [submitted]);

  // Live polling for collection status
  const { data: statusData } = useQuery({
    queryKey: ['collection-status', collectionId],
    queryFn: () => getCollectionStatus(collectionId!),
    enabled: !!collectionId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'completed' || s === 'failed' || s === 'monitoring') return false;
      return 5000;
    },
  });

  const isActive = !statusData || !['completed', 'failed', 'monitoring'].includes(statusData.status);
  const isDone = statusData && ['completed', 'monitoring'].includes(statusData.status);

  const platformSummary = data.summary.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  const statusLabel = !collectionId
    ? 'Creating collection…'
    : !statusData
      ? 'Starting…'
      : statusData.status === 'collecting'
        ? 'Collecting posts'
        : statusData.status === 'enriching'
          ? 'Enriching data'
          : statusData.status === 'completed'
            ? 'Complete'
            : statusData.status === 'monitoring'
              ? 'Monitoring'
              : statusData.status === 'failed'
                ? 'Failed'
                : statusData.status === 'pending'
                  ? 'Queued'
                  : statusData.status;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background shadow-sm">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-vibrant/10">
            <Search className="h-4 w-4 text-accent-vibrant" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Research Design</h4>
            <p className="text-xs text-muted-foreground">{platformSummary}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Details toggle */}
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Details
            {detailsOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>

          {/* Action buttons — hidden after submission */}
          {!formVisible && !submitted && (
            <>
              <button
                onClick={() => setFormVisible(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                onClick={handleDirectStart}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                Start
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Collapsable config details ── */}
      {detailsOpen && (
        <div className="border-t border-border/30 px-5 py-3 space-y-2.5">
          {data.summary.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground/60 mr-1">Keywords</span>
              {data.summary.keywords.map((kw) => (
                <Badge key={kw} variant="outline" className="text-[11px] font-normal text-muted-foreground">
                  {kw}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {data.summary.platforms.map((p) => (
              <span key={p} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: PLATFORM_COLORS[p] || '#78716C' }}
                />
                {PLATFORM_LABELS[p] || p}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <div>
              <p className="text-[10px] text-muted-foreground/60">Time range</p>
              <p className="text-[12px] font-medium text-foreground">{data.summary.time_range}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/60">API calls</p>
              <p className="text-[12px] font-medium text-foreground">{data.summary.estimated_api_calls}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/60">Est. time</p>
              <p className="text-[12px] font-medium text-foreground">~{data.summary.estimated_time_minutes} min</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline edit form ── */}
      {formVisible && !submitted && (
        <div ref={formContainerRef} className="border-t border-border/30">
          <CollectionForm
            prefill={data.config}
            onClose={() => setFormVisible(false)}
            variant="inline"
            onSubmitStart={() => {
              setFormVisible(false);
              setSubmitting(true);
            }}
            onSubmitSuccess={(id) => {
              setCollectionId(id);
              setSubmitting(false);
            }}
          />
        </div>
      )}

      {/* ── Live collection stats ── */}
      {submitted && (
        <div className="border-t border-border/30">
          {/* Status header — always visible */}
          <button
            onClick={() => setStatsOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors hover:bg-accent/20"
          >
            {/* Status indicator */}
            {isActive ? (
              submitting && !collectionId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-vibrant" />
              ) : (
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-vibrant opacity-50" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-vibrant" />
                </span>
              )
            ) : isDone ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : statusData?.status === 'failed' ? (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground animate-pulse" />
            )}

            <span className="flex-1 text-[13px] font-medium text-foreground">
              {statusLabel}
            </span>

            {statusData && statusData.posts_collected > 0 && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(statusData.posts_collected)} posts
              </span>
            )}

            {statsOpen ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </button>

          {/* Stats body */}
          {statsOpen && (
            <div className="px-5 pb-4 space-y-3">
              {/* Metric cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {formatNumber(statusData?.posts_collected ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Collected</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {formatNumber(statusData?.posts_enriched ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Enriched</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {formatNumber(statusData?.posts_embedded ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Embedded</p>
                </div>
              </div>

              {/* Progress bar */}
              {isActive && (
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-accent-vibrant transition-all duration-700 ease-out"
                    style={{
                      width: !collectionId
                        ? '5%'
                        : statusData?.status === 'enriching'
                          ? '80%'
                          : (statusData?.posts_collected ?? 0) > 0
                            ? '50%'
                            : '15%',
                    }}
                  />
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
              )}

              {isDone && (
                <div className="h-1.5 w-full rounded-full bg-emerald-500/20">
                  <div className="h-full w-full rounded-full bg-emerald-500 transition-all duration-500" />
                </div>
              )}

              {statusData?.status === 'failed' && statusData.error_message && (
                <p className="rounded-lg bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                  {statusData.error_message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
