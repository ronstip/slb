import { ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react';
import type { DataStory, MetricItem, ChartSpec } from '../../../../api/endpoints/briefings.ts';

// ─── Metric tone helpers ────────────────────────────────────────────

function metricToneClass(tone?: MetricItem['tone']): string {
  switch (tone) {
    case 'positive':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'negative':
      return 'text-rose-600 dark:text-rose-400';
    default:
      return 'text-foreground';
  }
}

function deltaIcon(delta?: string | null): React.ElementType | null {
  if (!delta) return null;
  const trimmed = delta.trim();
  if (trimmed.startsWith('+')) return TrendingUp;
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) return TrendingDown;
  return null;
}

// ─── Mini chart (inline SVG renderer for bar/pie/table) ─────────────
// Minimal, self-contained — no external chart dep. Handles the shapes the
// compose_briefing prompt produces. If we need more visual fidelity later,
// wire in the studio chart components.

function MiniChart({ spec }: { spec: ChartSpec }) {
  if (spec.chart_type === 'bar' || spec.chart_type === 'line') {
    return <MiniBarOrLine spec={spec} />;
  }
  if (spec.chart_type === 'pie' || spec.chart_type === 'doughnut') {
    return <MiniPie spec={spec} />;
  }
  if (spec.chart_type === 'table') {
    return <MiniTable spec={spec} />;
  }
  return null;
}

function MiniBarOrLine({ spec }: { spec: ChartSpec }) {
  const data = spec.data as {
    labels?: unknown[];
    series?: { name?: string; values?: unknown[] }[];
  };
  const labels = (data.labels ?? []).map(String);
  const series = data.series ?? [];
  const values = series[0]?.values?.map((v) => Number(v) || 0) ?? [];
  if (labels.length === 0 || values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="space-y-1.5">
      {labels.slice(0, 6).map((label, i) => {
        const v = values[i] ?? 0;
        const pct = Math.round((v / max) * 100);
        return (
          <div key={`${label}-${i}`} className="flex items-center gap-2 text-[12px]">
            <span className="w-16 shrink-0 truncate text-muted-foreground">{label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-sm bg-border/60">
              <div className="h-full bg-foreground/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-foreground">
              {v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniPie({ spec }: { spec: ChartSpec }) {
  const data = spec.data as { segments?: { label?: string; value?: unknown }[] };
  const segments = (data.segments ?? [])
    .map((s) => ({ label: String(s.label ?? ''), value: Number(s.value) || 0 }))
    .filter((s) => s.value > 0);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;
  const palette = ['bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-violet-500'];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-border/60">
        {segments.map((s, i) => (
          <div
            key={`${s.label}-${i}`}
            className={palette[i % palette.length]}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${Math.round((s.value / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
        {segments.slice(0, 5).map((s, i) => (
          <span key={`${s.label}-legend-${i}`} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${palette[i % palette.length]}`} />
            <span className="font-semibold text-foreground">{Math.round((s.value / total) * 100)}%</span>
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniTable({ spec }: { spec: ChartSpec }) {
  const data = spec.data as { columns?: unknown[]; rows?: unknown[][] };
  const columns = (data.columns ?? []).map(String);
  const rows = (data.rows ?? []).slice(0, 4).map((r) => (r ?? []).map(String));
  if (columns.length === 0 || rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-sm border border-border/80 text-[12px]">
      <div className="grid border-b border-border/80 bg-muted/40" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((c, i) => (
          <div key={`col-${i}`} className="px-2 py-1.5 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
            {c}
          </div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div
          key={`row-${ri}`}
          className="grid border-b border-border/40 last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {row.map((cell, ci) => (
            <div key={`cell-${ri}-${ci}`} className="truncate px-2 py-1.5 text-foreground">
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Shared metric strip ────────────────────────────────────────────

function MetricStrip({ metrics, size = 'compact' }: { metrics: MetricItem[]; size?: 'hero' | 'compact' }) {
  if (!metrics?.length) return null;
  const trimmed = metrics.slice(0, size === 'hero' ? 4 : 3);
  const cols =
    trimmed.length === 4 ? 'grid-cols-4' : trimmed.length === 3 ? 'grid-cols-3' : trimmed.length === 2 ? 'grid-cols-2' : 'grid-cols-1';
  if (size === 'hero') {
    return (
      <div className={`mt-6 grid ${cols} gap-x-6 border-y border-border py-4`}>
        {trimmed.map((m, i) => {
          const DeltaIcon = deltaIcon(m.delta);
          return (
            <div key={`${m.label}-${i}`} className="min-w-0">
              <div
                className={`font-serif text-[24px] font-bold leading-none tabular-nums tracking-tight ${metricToneClass(m.tone)}`}
              >
                {m.value}
              </div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {m.label}
              </div>
              {m.delta && (
                <div className={`mt-1 flex items-center gap-1 text-[11px] font-semibold tabular-nums ${metricToneClass(m.tone)}`}>
                  {DeltaIcon && <DeltaIcon className="h-3 w-3 shrink-0" />}
                  <span>{m.delta}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
      {trimmed.map((m, i) => (
        <span key={`${m.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-border">·</span>}
          <span className={`font-semibold ${metricToneClass(m.tone)}`}>{m.value}</span>
          <span>{m.label.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Hero variant ───────────────────────────────────────────────────

export function DataHero({ story, onOpen }: { story: DataStory; onOpen: () => void }) {
  return (
    <article className="mt-8 grid grid-cols-1 gap-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted/30 p-6 md:aspect-[5/4]">
        {story.chart ? (
          <div className="flex h-full w-full flex-col">
            {story.chart.title && (
              <p className="mb-3 font-serif text-[13px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {story.chart.title}
              </p>
            )}
            <div className="flex-1">
              <MiniChart spec={story.chart} />
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="grid w-full max-w-[360px] grid-cols-2 gap-6">
              {story.metrics.slice(0, 4).map((m, i) => (
                <div key={`${m.label}-${i}`}>
                  <div
                    className={`font-serif text-[30px] font-bold leading-none tabular-nums tracking-tight ${metricToneClass(m.tone)}`}
                  >
                    {m.value}
                  </div>
                  <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    {m.label}
                  </div>
                  {m.delta && (
                    <div className={`mt-1 text-[11px] font-semibold tabular-nums ${metricToneClass(m.tone)}`}>
                      {m.delta}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {story.section_label && <span className="text-foreground">{story.section_label}</span>}
          {story.timeframe && (
            <>
              {story.section_label && <span className="text-border">·</span>}
              <span>{story.timeframe}</span>
            </>
          )}
          {story.citations && story.citations.length > 0 && (
            <>
              <span className="text-border">·</span>
              <span>{story.citations.length} supporting post{story.citations.length === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
        <h2 className="mt-3 font-serif text-[36px] font-bold leading-[1.08] tracking-[-0.01em] text-foreground">
          {story.headline}
        </h2>
        <p className="mt-4 font-serif text-[17px] leading-relaxed text-foreground/80">
          {story.blurb}
        </p>
        {story.chart && <MetricStrip metrics={story.metrics} size="hero" />}
        <button
          type="button"
          onClick={onOpen}
          className="mt-5 flex w-fit items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          Read more
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

// ─── Secondary / grid variant ───────────────────────────────────────

export function DataStoryCard({ story, onOpen }: { story: DataStory; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-3 text-left transition-all hover:-translate-y-0.5"
    >
      <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-border bg-muted/30 p-4">
        {story.chart ? (
          <div className="flex h-full w-full flex-col">
            {story.chart.title && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {story.chart.title}
              </p>
            )}
            <div className="flex-1 overflow-hidden">
              <MiniChart spec={story.chart} />
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              {story.metrics.slice(0, 4).map((m, i) => (
                <div key={`${m.label}-${i}`}>
                  <div className={`font-serif text-[22px] font-bold leading-none tabular-nums ${metricToneClass(m.tone)}`}>
                    {m.value}
                  </div>
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        {(story.section_label || story.timeframe) && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {[story.section_label, story.timeframe].filter(Boolean).join(' · ')}
          </p>
        )}
        <h3 className="mt-1.5 font-serif text-[20px] font-semibold leading-snug text-foreground group-hover:text-primary">
          {story.headline}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          {story.blurb}
        </p>
        {story.chart && <MetricStrip metrics={story.metrics} />}
      </div>
    </button>
  );
}
