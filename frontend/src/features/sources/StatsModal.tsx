import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { getCollectionStats } from '../../api/endpoints/collections.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import type { Source } from '../../stores/sources-store.ts';

interface StatsModalProps {
  source: Source;
  open: boolean;
  onClose: () => void;
}

export function StatsModal({ source, open, onClose }: StatsModalProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['collection-stats', source.collectionId],
    queryFn: () => getCollectionStats(source.collectionId),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const platformData = (stats?.platform_breakdown ?? []).map((d) => ({
    name: PLATFORM_LABELS[d.platform] || d.platform,
    count: d.count,
    platform: d.platform,
  }));

  const sentimentData = (stats?.sentiment_breakdown ?? []).map((d) => ({
    ...d,
    percentage: stats
      ? Math.round((d.count / Math.max(1, stats.total_posts)) * 100)
      : 0,
  }));

  const isEnriched = sentimentData.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{source.title}</DialogTitle>
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
              <span>
                <span className="text-muted-foreground">Posts: </span>
                <span className="font-semibold">{formatNumber(stats.total_posts)}</span>
              </span>
              {stats.date_range.earliest && (
                <span>
                  <span className="text-muted-foreground">From: </span>
                  <span className="font-medium">{shortDate(stats.date_range.earliest)}</span>
                </span>
              )}
              {stats.date_range.latest && (
                <span>
                  <span className="text-muted-foreground">To: </span>
                  <span className="font-medium">{shortDate(stats.date_range.latest)}</span>
                </span>
              )}
              {stats.engagement_summary.total_posts_enriched > 0 && (
                <span>
                  <span className="text-muted-foreground">Enriched: </span>
                  <span className="font-medium">{formatNumber(stats.engagement_summary.total_posts_enriched)}</span>
                </span>
              )}
            </div>

            {/* Platform breakdown */}
            {platformData.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Platform Breakdown
                </p>
                <ResponsiveContainer width="100%" height={Math.max(80, platformData.length * 28)}>
                  <BarChart data={platformData} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={72}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [v, 'Posts']} />
                    <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={14}>
                      {platformData.map((entry) => (
                        <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] || '#78716C'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Sentiment split */}
            {isEnriched && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sentiment
                </p>
                <div className="flex items-center gap-5">
                  <ResponsiveContainer width={100} height={100}>
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        dataKey="count"
                        nameKey="sentiment"
                        cx="50%"
                        cy="50%"
                        innerRadius={25}
                        outerRadius={46}
                        labelLine={false}
                      >
                        {sentimentData.map((entry) => (
                          <Cell
                            key={entry.sentiment}
                            fill={SENTIMENT_COLORS[entry.sentiment] || '#78716C'}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => [v, 'posts']} contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1">
                    {sentimentData.map((item) => (
                      <div key={item.sentiment} className="flex items-center gap-2 text-xs">
                        <div
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: SENTIMENT_COLORS[item.sentiment] || '#78716C' }}
                        />
                        <span className="capitalize text-muted-foreground">
                          {item.sentiment}{' '}
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
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Top Themes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stats.top_themes.map((t) => (
                    <Badge key={t.theme} variant="secondary" className="text-xs capitalize">
                      {t.theme}
                      <span className="ml-1.5 text-muted-foreground">{t.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Engagement */}
            {(stats.engagement_summary.avg_likes > 0 || stats.engagement_summary.avg_views > 0) && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Avg. Engagement
                </p>
                <div className="flex gap-6 text-sm">
                  <span>
                    <span className="text-muted-foreground">Likes: </span>
                    <span className="font-medium">{formatNumber(Math.round(stats.engagement_summary.avg_likes))}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Views: </span>
                    <span className="font-medium">{formatNumber(Math.round(stats.engagement_summary.avg_views))}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Comments: </span>
                    <span className="font-medium">{formatNumber(Math.round(stats.engagement_summary.avg_comments))}</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No stats available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
