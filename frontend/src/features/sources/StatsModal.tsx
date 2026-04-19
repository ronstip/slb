import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { getCollectionStats, refreshCollectionStats } from '../../api/endpoints/collections.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import type { BreakdownItem } from '../../api/types.ts';
import type { Source } from '../../stores/sources-store.ts';

interface StatsModalProps {
  source: Source;
  open: boolean;
  onClose: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export function StatsModal({ source, open, onClose }: StatsModalProps) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['collection-stats', source.collectionId],
    queryFn: () => getCollectionStats(source.collectionId),
    enabled: open,
    staleTime: Infinity,
  });

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      const fresh = await refreshCollectionStats(source.collectionId);
      queryClient.setQueryData(['collection-stats', source.collectionId], fresh);
    } finally {
      setIsRefreshing(false);
    }
  }

  const platformData = (stats?.platform_breakdown ?? []).map((d) => ({
    name: PLATFORM_LABELS[d.value] || d.value,
    post_count: d.post_count,
    platform: d.value,
  }));

  const sentimentData = (stats?.sentiment_breakdown ?? []).map((d) => ({
    ...d,
    percentage: stats
      ? Math.round((d.post_count / Math.max(1, stats.total_posts)) * 100)
      : 0,
  }));

  const isEnriched = sentimentData.length > 0;
  const eng = stats?.engagement_summary;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-base tracking-tight">{source.title}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-md bg-secondary" />
            ))}
          </div>
        ) : stats ? (
          <div className="space-y-5 pt-1">
            {/* Overview row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <StatChip label="Posts" value={formatNumber(stats.total_posts)} />
              {stats.total_unique_channels > 0 && (
                <StatChip label="Channels" value={formatNumber(stats.total_unique_channels)} />
              )}
              {stats.date_range.earliest && (
                <StatChip label="From" value={shortDate(stats.date_range.earliest)} />
              )}
              {stats.date_range.latest && (
                <StatChip label="To" value={shortDate(stats.date_range.latest)} />
              )}
              {stats.total_posts_enriched > 0 && (
                <StatChip label="Enriched" value={formatNumber(stats.total_posts_enriched)} />
              )}
            </div>

            {/* Engagement totals */}
            {eng && (eng.total_views > 0 || eng.total_likes > 0) && (
              <div>
                <SectionLabel>Total Engagement</SectionLabel>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {eng.total_views > 0 && (
                    <StatChip label="Views" value={formatNumber(eng.total_views)} />
                  )}
                  {eng.total_likes > 0 && (
                    <StatChip label="Likes" value={formatNumber(eng.total_likes)} />
                  )}
                  {eng.total_comments > 0 && (
                    <StatChip label="Comments" value={formatNumber(eng.total_comments)} />
                  )}
                  {eng.total_shares > 0 && (
                    <StatChip label="Shares" value={formatNumber(eng.total_shares)} />
                  )}
                </div>
              </div>
            )}

            {/* Platform breakdown */}
            {platformData.length > 0 && (
              <div>
                <SectionLabel>Platform Breakdown</SectionLabel>
                <ResponsiveContainer width="100%" height={Math.max(80, platformData.length * 28)}>
                  <BarChart
                    data={platformData}
                    layout="vertical"
                    margin={{ left: 0, right: 24, top: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={72}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(v) => [formatNumber(v as number), 'Posts']}
                    />
                    <Bar dataKey="post_count" radius={[0, 3, 3, 0]} barSize={14}>
                      {platformData.map((entry) => (
                        <Cell
                          key={entry.platform}
                          fill={PLATFORM_COLORS[entry.platform] || '#78716C'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Sentiment */}
            {isEnriched && (
              <div>
                <SectionLabel>Sentiment</SectionLabel>
                <div className="flex items-center gap-5">
                  <ResponsiveContainer width={100} height={100}>
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        dataKey="post_count"
                        nameKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={25}
                        outerRadius={46}
                        labelLine={false}
                      >
                        {sentimentData.map((entry) => (
                          <Cell
                            key={entry.value}
                            fill={SENTIMENT_COLORS[entry.value] || '#78716C'}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) => [formatNumber(v as number), 'posts']}
                        contentStyle={{ fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1">
                    {sentimentData.map((item) => (
                      <div key={item.value} className="flex items-center gap-2 text-xs">
                        <div
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: SENTIMENT_COLORS[item.value] || '#78716C' }}
                        />
                        <span className="capitalize text-muted-foreground">
                          {item.value}{' '}
                          <span className="font-medium text-foreground/80">
                            {item.percentage}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Top themes */}
            {stats.top_themes.length > 0 && (
              <BreakdownBadges label="Top Themes" items={stats.top_themes} />
            )}

            {/* Top entities */}
            {stats.top_entities.length > 0 && (
              <BreakdownBadges label="Top Entities" items={stats.top_entities} />
            )}

            {/* Language breakdown */}
            {stats.language_breakdown.length > 0 && (
              <BreakdownBadges label="Languages" items={stats.language_breakdown} />
            )}

            {/* Content type breakdown */}
            {stats.content_type_breakdown.length > 0 && (
              <BreakdownBadges label="Content Types" items={stats.content_type_breakdown} />
            )}

            {/* Avg + max + median engagement */}
            {eng && (eng.avg_likes > 0 || eng.avg_views > 0) && (
              <div>
                <SectionLabel>Avg. Engagement per Post</SectionLabel>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {eng.avg_views > 0 && (
                    <StatChip label="Views" value={formatNumber(Math.round(eng.avg_views))} />
                  )}
                  {eng.avg_likes > 0 && (
                    <StatChip label="Likes" value={formatNumber(Math.round(eng.avg_likes))} />
                  )}
                  {eng.avg_comments > 0 && (
                    <StatChip label="Comments" value={formatNumber(Math.round(eng.avg_comments))} />
                  )}
                  {eng.avg_shares > 0 && (
                    <StatChip label="Shares" value={formatNumber(Math.round(eng.avg_shares))} />
                  )}
                </div>
                {(eng.max_likes > 0 || eng.max_views > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {eng.max_views > 0 && (
                      <StatChip label="Max views" value={formatNumber(Math.round(eng.max_views))} />
                    )}
                    {eng.max_likes > 0 && (
                      <StatChip label="Max likes" value={formatNumber(Math.round(eng.max_likes))} />
                    )}
                    {eng.median_views > 0 && (
                      <StatChip
                        label="Median views"
                        value={formatNumber(Math.round(eng.median_views))}
                      />
                    )}
                    {eng.median_likes > 0 && (
                      <StatChip
                        label="Median likes"
                        value={formatNumber(Math.round(eng.median_likes))}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Footer: computed_at + status badge + refresh */}
            <div className="flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                {stats.computed_at && (
                  <span>Computed {shortDate(stats.computed_at)}</span>
                )}
                {stats.collection_status_at_compute && (
                  <Badge
                    variant={
                      stats.collection_status_at_compute === 'success' ? 'secondary' : 'outline'
                    }
                    className="text-[10px]"
                  >
                    {stats.collection_status_at_compute === 'success'
                      ? 'complete snapshot'
                      : 'partial — still running'}
                  </Badge>
                )}
              </div>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-secondary disabled:opacity-50"
                title="Refresh stats"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No stats available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BreakdownBadges({ label, items }: { label: string; items: BreakdownItem[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item.value} variant="secondary" className="text-xs capitalize">
            {item.value}
            <span className="ml-1.5 text-muted-foreground">{formatNumber(item.post_count)}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
