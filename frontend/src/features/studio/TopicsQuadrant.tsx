import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { Card } from '../../components/ui/card.tsx';
import { formatNumber } from '../../lib/format.ts';
import type { TopicCluster } from '../../api/types.ts';

interface TopicsQuadrantProps {
  topics: TopicCluster[];
  onTopicSelect?: (clusterId: string) => void;
}

interface QuadrantPoint {
  clusterId: string;
  name: string;
  x: number; // virality (views per post)
  y: number; // sentiment ratio, -1..1
  z: number; // post count (bubble size)
  color: string;
  posts: number;
  views: number;
}

function sentimentColor(ratio: number): string {
  if (ratio >= 0) {
    const t = Math.min(1, ratio);
    const r = Math.round(148 - t * 114);
    const g = Math.round(163 + t * 32);
    const b = Math.round(184 - t * 94);
    return `rgb(${r},${g},${b})`;
  }
  const t = Math.min(1, -ratio);
  const r = Math.round(148 + t * 91);
  const g = Math.round(163 - t * 95);
  const b = Math.round(184 - t * 116);
  return `rgb(${r},${g},${b})`;
}

function buildPoints(topics: TopicCluster[]): QuadrantPoint[] {
  const points: QuadrantPoint[] = [];
  for (const t of topics) {
    const posts = t.post_count ?? 0;
    const views = t.total_views ?? 0;
    if (!posts) continue;
    const virality = views > 0 ? views / posts : 1; // floor at 1 so log scale stays defined
    const pos = t.positive_count ?? 0;
    const neg = t.negative_count ?? 0;
    const denom = pos + neg;
    const sentiment = denom > 0 ? (pos - neg) / denom : 0;
    points.push({
      clusterId: t.cluster_id,
      name: t.topic_name,
      x: Math.max(1, virality),
      y: sentiment,
      z: posts,
      color: sentimentColor(sentiment),
      posts,
      views,
    });
  }
  return points;
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatAxisTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

function QuadrantTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: QuadrantPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const sentimentLabel = p.y > 0.15 ? 'positive' : p.y < -0.15 ? 'negative' : 'mixed';
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <div className="text-[12px] font-semibold text-foreground line-clamp-2 max-w-[220px]">
        {p.name}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{p.posts} posts</span>
        <span>·</span>
        <span>x{formatNumber(Math.round(p.x))} virality</span>
        <span>·</span>
        <span style={{ color: p.color }}>{sentimentLabel}</span>
      </div>
    </div>
  );
}

export function TopicsQuadrant({ topics, onTopicSelect }: TopicsQuadrantProps) {
  const points = useMemo(() => buildPoints(topics), [topics]);

  const xMedian = useMemo(() => median(points.map((p) => p.x)), [points]);
  const xDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [1, 100];
    const xs = points.map((p) => p.x);
    const min = Math.max(1, Math.min(...xs));
    const max = Math.max(...xs);
    return [Math.floor(min / 1.5), Math.ceil(max * 1.5)];
  }, [points]);

  if (points.length < 3) return null;

  const LABEL_CLASS = 'text-[9px] font-medium uppercase tracking-wider fill-muted-foreground/60';

  return (
    <Card className="px-3 pt-3 pb-1.5 !gap-0 bg-background">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Virality × Sentiment
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          Bubble size = posts · Click to jump
        </span>
      </div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 12, bottom: 20, left: 8 }}>
            {/* Quadrant background tints (subtle) */}
            <ReferenceArea x1={xMedian} x2={xDomain[1]} y1={0} y2={1} fill="#5FB88A" fillOpacity={0.05} />
            <ReferenceArea x1={xMedian} x2={xDomain[1]} y1={-1} y2={0} fill="#C75A62" fillOpacity={0.05} />
            <ReferenceArea x1={xDomain[0]} x2={xMedian} y1={0} y2={1} fill="#5FB88A" fillOpacity={0.02} />
            <ReferenceArea x1={xDomain[0]} x2={xMedian} y1={-1} y2={0} fill="#C75A62" fillOpacity={0.02} />

            {/* Quadrant labels */}
            <text x="96%" y={28} textAnchor="end" className={LABEL_CLASS}>Amplifiers</text>
            <text x="96%" y="92%" textAnchor="end" className={LABEL_CLASS}>Risks</text>
            <text x="4%" y={28} textAnchor="start" className={LABEL_CLASS}>Fans</text>
            <text x="4%" y="92%" textAnchor="start" className={LABEL_CLASS}>Gripes</text>

            <XAxis
              type="number"
              dataKey="x"
              scale="log"
              domain={xDomain}
              allowDataOverflow
              tickFormatter={formatAxisTick}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={{ stroke: 'var(--border)' }}
              label={{
                value: 'Virality (views / post)',
                position: 'insideBottom',
                offset: -8,
                style: { fontSize: 10, fill: 'var(--muted-foreground)' },
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[-1, 1]}
              ticks={[-1, -0.5, 0, 0.5, 1]}
              tickFormatter={(v: number) =>
                v === 1 ? 'Pos' : v === -1 ? 'Neg' : v === 0 ? '0' : ''
              }
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={{ stroke: 'var(--border)' }}
              width={32}
            />
            <ZAxis type="number" dataKey="z" range={[60, 420]} />
            <ReferenceLine x={xMedian} stroke="var(--border)" strokeDasharray="3 3" />
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
            <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter
              data={points}
              shape={(props: { cx?: number; cy?: number; payload?: QuadrantPoint; node?: { z?: number } }) => {
                const { cx, cy, payload, node } = props;
                if (cx == null || cy == null || !payload) return <g />;
                const area = node?.z ?? 120;
                const r = Math.max(4, Math.sqrt(area / Math.PI));
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={payload.color}
                    fillOpacity={0.6}
                    stroke={payload.color}
                    strokeWidth={1.5}
                    style={{ cursor: onTopicSelect ? 'pointer' : 'default' }}
                  />
                );
              }}
              onClick={(data: { clusterId?: string } | undefined) => {
                if (data?.clusterId) onTopicSelect?.(data.clusterId);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
