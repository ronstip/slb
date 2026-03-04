import { useState, useRef, useEffect } from 'react';
import { Play, Edit2, ChevronDown, ChevronUp, Search, Loader2 } from 'lucide-react';
import type { DesignResearchResult, CreateCollectionRequest } from '../../../api/types.ts';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '../../../lib/constants.ts';
import { createCollection } from '../../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { CollectionForm } from '../../sources/CollectionForm.tsx';
import { CollectionProgressCard } from './CollectionProgressCard.tsx';
import { Badge } from '../../../components/ui/badge.tsx';

interface ResearchDesignCardProps {
  data: DesignResearchResult;
  onCollectionStarted?: (message: string) => void;
}

export function ResearchDesignCard({ data, onCollectionStarted }: ResearchDesignCardProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const formContainerRef = useRef<HTMLDivElement>(null);

  const addSource = useSourcesStore((s) => s.addSource);

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

  const platformSummary = data.summary.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

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
