import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  ArrowUpRight,
  Eye,
  MessageSquare,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import {
  getAgentBriefing,
  type BriefingLayout,
  type BriefingPulse,
  type Story,
  type TopicStory,
  type DataStory,
  type TopicStats,
  type MetricItem,
} from '../../../../api/endpoints/briefings.ts';
import { mediaUrl } from '../../../../api/client.ts';
import { formatNumber, timeAgo } from '../../../../lib/format.ts';
import { DataStoryCard, DataHero } from './DataStoryCard.tsx';

interface AgentBriefingTabProps {
  task: Agent;
}

function resolveImage(gcs: string | null | undefined, original: string | null | undefined): string | null {
  if (!gcs && !original) return null;
  return mediaUrl(gcs ?? undefined, original ?? undefined) || null;
}

function formatDateRange(earliest: string | null, latest: string | null): string | null {
  if (!earliest || !latest) return null;
  const e = new Date(earliest);
  const l = new Date(latest);
  if (Number.isNaN(e.getTime()) || Number.isNaN(l.getTime())) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (fmt(e) === fmt(l)) return fmt(l);
  return `${fmt(e)} → ${fmt(l)}`;
}

export function AgentBriefingTab({ task }: AgentBriefingTabProps) {
  const agentId = task.agent_id;
  const [, setSearchParams] = useSearchParams();

  const { data: briefing, isLoading, isError } = useQuery({
    queryKey: ['agent-briefing', agentId],
    queryFn: () => getAgentBriefing(agentId),
    retry: false,
  });

  const openStory = (story: Story) => {
    if (story.type === 'topic') {
      setSearchParams({ tab: 'topics', topic: story.topic_id }, { replace: false });
    }
    // Data stories don't link to a topic — no-op for now.
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !briefing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-serif text-2xl text-foreground">No briefing yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          This agent's next run will produce a briefing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1200px] px-8 py-10">
        <Masthead agentTitle={task.title} generatedAt={briefing.generated_at} />

        {briefing.pulse && <PulseBar pulse={briefing.pulse} />}

        {briefing.editors_note && (
          <p className="mt-6 border-l-2 border-foreground/30 pl-4 font-serif text-[15px] italic leading-relaxed text-foreground/75">
            <span className="font-semibold not-italic">Editor's note —</span> {briefing.editors_note}
          </p>
        )}

        <HeroBlock hero={briefing.hero} onOpen={() => openStory(briefing.hero)} />

        {briefing.secondary.length > 0 && (
          <SecondarySection stories={briefing.secondary} onOpen={openStory} />
        )}

        {briefing.rail.length > 0 && (
          <RailSection stories={briefing.rail} onOpen={openStory} />
        )}
      </div>
    </div>
  );
}

// ─── Masthead ────────────────────────────────────────────────────────

function Masthead({ agentTitle, generatedAt }: { agentTitle: string; generatedAt: string }) {
  const when = generatedAt ? timeAgo(generatedAt) : '';
  return (
    <header className="border-b border-foreground/80 pb-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.3em] text-foreground">
          The Briefing
        </p>
        {when && (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Issue · {when}
          </p>
        )}
      </div>
      <h1 className="mt-2 truncate font-serif text-[38px] font-bold leading-[1.1] tracking-tight text-foreground">
        {agentTitle}
      </h1>
    </header>
  );
}

// ─── Pulse ──────────────────────────────────────────────────────────

function PulseBar({ pulse }: { pulse: BriefingPulse }) {
  const { sentiment } = pulse;
  const segments = [
    { key: 'positive', pct: sentiment.positive_pct, color: 'bg-emerald-500', label: 'Positive' },
    { key: 'negative', pct: sentiment.negative_pct, color: 'bg-rose-500', label: 'Negative' },
    { key: 'neutral', pct: sentiment.neutral_pct, color: 'bg-muted-foreground/40', label: 'Neutral' },
    { key: 'mixed', pct: sentiment.mixed_pct, color: 'bg-amber-500', label: 'Mixed' },
  ].filter((s) => s.pct > 0);

  const series = pulse.posts_per_day ?? [];
  const hasSparkline = series.length >= 2 && series.some((v) => v > 0);

  return (
    <section
      className={`mt-5 grid grid-cols-1 gap-5 border border-border bg-muted/30 px-5 py-4 ${
        hasSparkline ? 'sm:grid-cols-[auto_1fr_auto]' : 'sm:grid-cols-[auto_1fr]'
      }`}
    >
      <div className="flex items-center gap-6 sm:border-r sm:border-border sm:pr-6">
        <PulseNumber value={formatNumber(pulse.total_posts)} label={pulse.total_posts === 1 ? 'Post' : 'Posts'} />
        <PulseNumber value={formatNumber(pulse.total_views)} label="Views" />
        <PulseNumber value={String(pulse.topic_count)} label="Topics" />
      </div>
      <div className="flex flex-col justify-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Sentiment distribution
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-border/60">
          {segments.map((s) => (
            <div key={s.key} className={s.color} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct}%`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              <span>
                <span className="font-semibold text-foreground">{s.pct}%</span> {s.label.toLowerCase()}
              </span>
            </span>
          ))}
        </div>
      </div>
      {hasSparkline && <PostsSparkline series={series} />}
    </section>
  );
}

function PostsSparkline({ series }: { series: number[] }) {
  const total = series.reduce((a, b) => a + b, 0);
  const max = Math.max(...series, 1);
  const w = 120;
  const h = 36;
  const padX = 1.5;
  const padY = 4;
  const stepX = series.length > 1 ? (w - padX * 2) / (series.length - 1) : 0;
  const points = series.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (h - padY * 2) * (1 - v / max);
    return [x, y] as const;
  });
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${h - padY} L${points[0][0].toFixed(1)},${h - padY} Z`;
  const last = points[points.length - 1];

  return (
    <div
      className="flex flex-col justify-center sm:border-l sm:border-border sm:pl-6"
      title={`Posts per day (last ${series.length}d) — total ${total}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        Last {series.length}d
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        className="mt-2 overflow-visible text-foreground/70"
        aria-label="Posts per day sparkline"
      >
        <path d={areaPath} fill="currentColor" opacity={0.08} />
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r={1.75} fill="currentColor" />
      </svg>
    </div>
  );
}

function PulseNumber({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-serif text-[26px] font-bold leading-none tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Stats (topic stories) ──────────────────────────────────────────

interface StatItem {
  icon?: React.ElementType;
  value: string;
  label: string;
  tone?: 'positive' | 'negative' | 'default';
}

function buildStatItems(stats: TopicStats, variant: 'hero' | 'compact'): StatItem[] {
  const items: StatItem[] = [];
  if (variant === 'compact' && stats.post_count > 0) {
    items.push({ value: formatNumber(stats.post_count), label: stats.post_count === 1 ? 'post' : 'posts' });
  }
  if (stats.total_views > 0) {
    items.push({ icon: variant === 'compact' ? Eye : undefined, value: formatNumber(stats.total_views), label: 'views' });
  }
  if (variant === 'hero' && stats.avg_views > 0) {
    items.push({ value: formatNumber(stats.avg_views), label: 'avg / post' });
  }
  if (variant === 'hero' && stats.total_likes > 0) {
    items.push({ icon: MessageSquare, value: formatNumber(stats.total_likes), label: 'likes' });
  }
  if (stats.positive_pct != null && stats.negative_pct != null) {
    if (stats.positive_pct >= stats.negative_pct) {
      items.push({ icon: TrendingUp, value: `${stats.positive_pct}%`, label: 'positive', tone: 'positive' });
    } else {
      items.push({ icon: TrendingDown, value: `${stats.negative_pct}%`, label: 'negative', tone: 'negative' });
    }
  }
  if (variant === 'compact') {
    const dateRange = formatDateRange(stats.earliest_post, stats.latest_post);
    if (dateRange) items.push({ value: dateRange, label: '' });
  }
  return items;
}

function toneClass(tone: StatItem['tone']): string {
  switch (tone) {
    case 'positive':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'negative':
      return 'text-rose-600 dark:text-rose-400';
    default:
      return 'text-foreground';
  }
}

function HeroStatsStrip({ stats }: { stats: TopicStats }) {
  const items = buildStatItems(stats, 'hero').slice(0, 4);
  if (items.length === 0) return null;
  const cols =
    items.length === 4 ? 'grid-cols-4' : items.length === 3 ? 'grid-cols-3' : items.length === 2 ? 'grid-cols-2' : 'grid-cols-1';
  return (
    <div className={`mt-6 grid ${cols} gap-x-6 border-y border-border py-4`}>
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className="min-w-0">
          <div
            className={`font-serif text-[24px] font-bold leading-none tabular-nums tracking-tight ${toneClass(it.tone)}`}
          >
            {it.value}
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {it.icon && <it.icon className="h-3 w-3 shrink-0" />}
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompactStatsStrip({ stats }: { stats: TopicStats }) {
  const items = buildStatItems(stats, 'compact');
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
      {items.map((it, idx) => (
        <span key={`${it.label}-${idx}`} className="flex items-center gap-1">
          {idx > 0 && <span className="text-border">·</span>}
          <span className={`font-semibold ${toneClass(it.tone)}`}>{it.value}</span>
          {it.label && <span>{it.label}</span>}
        </span>
      ))}
    </div>
  );
}

// ─── Placeholder tile (when no image is available) ──────────────────

function _hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const _PLACEHOLDER_PALETTE = [
  'from-slate-800 via-slate-700 to-slate-900',
  'from-zinc-800 via-zinc-700 to-zinc-900',
  'from-neutral-800 via-stone-700 to-neutral-900',
  'from-slate-700 via-indigo-900 to-slate-900',
  'from-stone-800 via-amber-900/40 to-stone-900',
  'from-slate-800 via-emerald-900/40 to-slate-900',
  'from-zinc-800 via-rose-900/30 to-zinc-900',
];

export function PlaceholderTile({ seed, label }: { seed: string; label?: string | null }) {
  const palette = _PLACEHOLDER_PALETTE[_hashString(seed) % _PLACEHOLDER_PALETTE.length];
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${palette} p-5`}>
      {label && (
        <span className="line-clamp-4 text-center font-serif text-[17px] font-semibold leading-snug text-white/90">
          {label}
        </span>
      )}
    </div>
  );
}

// ─── Hero (dispatches on story.type) ────────────────────────────────

function HeroBlock({ hero, onOpen }: { hero: Story; onOpen: () => void }) {
  if (hero.type === 'data') {
    return <DataHero story={hero} onOpen={onOpen} />;
  }
  return <TopicHero hero={hero} onOpen={onOpen} />;
}

function TopicHeroMeta({ hero }: { hero: TopicStory }) {
  if (!hero.stats) return null;
  const dateRange = formatDateRange(hero.stats.earliest_post, hero.stats.latest_post);
  const postWord = hero.stats.post_count === 1 ? 'post' : 'posts';
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {hero.section_label && <span className="text-foreground">{hero.section_label}</span>}
      {hero.stats.post_count > 0 && (
        <>
          {hero.section_label && <span className="text-border">·</span>}
          <span>
            {formatNumber(hero.stats.post_count)} {postWord}
          </span>
        </>
      )}
      {dateRange && (
        <>
          <span className="text-border">·</span>
          <span>{dateRange}</span>
        </>
      )}
    </div>
  );
}

function TopicHero({ hero, onOpen }: { hero: TopicStory; onOpen: () => void }) {
  const initialSrc = resolveImage(hero.image_gcs_uri, hero.image_original_url);
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!initialSrc && !imgFailed;

  return (
    <article className="mt-8 grid grid-cols-1 gap-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted md:aspect-[5/4]">
        {showImage ? (
          <img
            src={initialSrc!}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <PlaceholderTile seed={hero.topic_id} label={hero.headline} />
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <TopicHeroMeta hero={hero} />
        <h2 className="mt-3 font-serif text-[36px] font-bold leading-[1.08] tracking-[-0.01em] text-foreground">
          {hero.headline}
        </h2>
        {hero.topic_name && (
          <p className="mt-2 text-[12px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {hero.topic_name}
          </p>
        )}
        <p className="mt-4 font-serif text-[17px] leading-relaxed text-foreground/80">
          {hero.blurb}
        </p>
        {hero.stats && <HeroStatsStrip stats={hero.stats} />}
        <button
          type="button"
          onClick={onOpen}
          className="mt-5 flex w-fit items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Read topic
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

// ─── Secondary grid ─────────────────────────────────────────────────

function SecondarySection({ stories, onOpen }: { stories: Story[]; onOpen: (s: Story) => void }) {
  return (
    <section className="mt-12">
      <SectionHeader label="More stories" />
      <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story, i) => (
          <SecondaryCard key={`${story.type}-${i}`} story={story} onOpen={() => onOpen(story)} />
        ))}
      </div>
    </section>
  );
}

function SecondaryCard({ story, onOpen }: { story: Story; onOpen: () => void }) {
  if (story.type === 'data') {
    return <DataStoryCard story={story} onOpen={onOpen} />;
  }
  return <TopicSecondaryCard story={story} onOpen={onOpen} />;
}

function TopicSecondaryCard({ story, onOpen }: { story: TopicStory; onOpen: () => void }) {
  const initialSrc = resolveImage(story.thumbnail_gcs_uri, story.thumbnail_original_url);
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!initialSrc && !imgFailed;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-3 text-left transition-all hover:-translate-y-0.5"
    >
      <div className="aspect-[16/10] w-full overflow-hidden rounded-md bg-muted">
        {showImage ? (
          <img
            src={initialSrc!}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <PlaceholderTile seed={story.topic_id} label={story.headline} />
        )}
      </div>
      <div>
        {story.topic_name && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {story.topic_name}
          </p>
        )}
        <h3 className="mt-1.5 font-serif text-[20px] font-semibold leading-snug text-foreground group-hover:text-primary">
          {story.headline}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          {story.blurb}
        </p>
        {story.stats && <CompactStatsStrip stats={story.stats} />}
      </div>
    </button>
  );
}

// ─── Rail ───────────────────────────────────────────────────────────

function RailSection({ stories, onOpen }: { stories: Story[]; onOpen: (s: Story) => void }) {
  const sorted = useMemo(
    () => [...stories].sort((a, b) => a.rank - b.rank),
    [stories],
  );
  return (
    <section className="mt-14 border-t border-border pt-6">
      <SectionHeader label="Also tracking" />
      <ul className="mt-3 divide-y divide-border">
        {sorted.map((story, i) => (
          <li key={`${story.type}-${i}`}>
            <button
              type="button"
              onClick={() => onOpen(story)}
              className="group flex w-full items-start gap-4 py-3.5 text-left"
            >
              <span className="shrink-0 pt-1 font-serif text-sm font-semibold tabular-nums text-muted-foreground group-hover:text-primary">
                {String(story.rank).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[17px] font-semibold leading-snug text-foreground group-hover:text-primary">
                  {story.headline}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {story.blurb}
                </span>
                {story.type === 'topic' && story.stats ? (
                  <CompactStatsStrip stats={story.stats} />
                ) : story.type === 'data' ? (
                  <RailDataMetrics metrics={story.metrics} timeframe={story.timeframe} />
                ) : null}
              </span>
              {story.type === 'topic' && story.topic_name && (
                <span className="hidden shrink-0 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:block">
                  {story.topic_name}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RailDataMetrics({ metrics, timeframe }: { metrics: MetricItem[]; timeframe?: string | null }) {
  if (!metrics?.length && !timeframe) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
      {metrics.slice(0, 3).map((m, i) => (
        <span key={`${m.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-border">·</span>}
          <span
            className={`font-semibold ${
              m.tone === 'positive'
                ? 'text-emerald-600 dark:text-emerald-400'
                : m.tone === 'negative'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-foreground'
            }`}
          >
            {m.value}
          </span>
          <span>{m.label.toLowerCase()}</span>
        </span>
      ))}
      {timeframe && (
        <span className="flex items-center gap-1">
          <span className="text-border">·</span>
          <span>{timeframe}</span>
        </span>
      )}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-foreground/80 pt-3">
      <span className="font-serif text-[13px] font-bold uppercase tracking-[0.2em] text-foreground">
        {label}
      </span>
    </div>
  );
}

export { formatDateRange, resolveImage };
export type { BriefingLayout, Story, TopicStory, DataStory };
