import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Search, Share2, Sparkles, Star, Table2, X } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import {
  getArtifact,
  type ArtifactListItem,
} from '../../../../api/endpoints/artifacts.ts';
import { getBriefingMeta } from '../../../../api/endpoints/briefings.ts';
import { useOpenBriefingShare } from '../../../briefings/use-open-briefing-share.ts';
import { Button } from '../../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { SocialChartWidget } from '../../../studio/dashboard/SocialChartWidget.tsx';
import type {
  SocialChartType,
  WidgetData,
} from '../../../studio/dashboard/types-social-dashboard.ts';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';
import { formatNumber, shortDate, timeAgo } from '../../../../lib/format.ts';
import { cn } from '../../../../lib/utils.ts';
import {
  KIND_VISUALS,
  artifactTypeToKind,
  type DeliverableKind,
} from './deliverable-visuals.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Types

type ItemKind = Extract<
  DeliverableKind,
  'briefing' | 'slides' | 'chart' | 'data_export'
>;

type CreationKind = 'slides' | 'chart' | 'data_export';

type FilterKind = ItemKind | 'all';

interface DeliverableItem {
  id: string;
  kind: ItemKind;
  title: string;
  subtitle: string;
  createdAt: string;
  onOpen: () => void;
  artifact?: ArtifactListItem;
}

type CardSize = 'sm' | 'md' | 'wide' | 'tall' | 'huge';

const SIZE_CLASSES: Record<CardSize, string> = {
  sm: 'col-span-2 sm:col-span-3 lg:col-span-3 row-span-1',
  md: 'col-span-2 sm:col-span-3 lg:col-span-4 row-span-1',
  wide: 'col-span-2 sm:col-span-6 lg:col-span-6 row-span-1',
  tall: 'col-span-2 sm:col-span-3 lg:col-span-4 row-span-2',
  huge: 'col-span-2 sm:col-span-6 lg:col-span-6 row-span-2',
};

const TALL_SIZES = new Set<CardSize>(['tall', 'huge']);

function sizeForItem(item: DeliverableItem): CardSize {
  if (item.kind === 'briefing') return 'tall';
  if (item.kind === 'slides') return 'md';
  if (item.kind === 'data_export') return 'md';
  if (item.kind === 'chart') {
    const ct = (item.artifact?.chart_type ?? '').toLowerCase();
    if (ct === 'line' || ct === 'area') return 'wide';
    if (ct === 'table') return 'huge';
    if (ct === 'pie' || ct === 'doughnut' || ct === 'number') return 'sm';
    return 'md';
  }
  return 'md';
}

function computeSizes(items: DeliverableItem[]): CardSize[] {
  return items.map(sizeForItem);
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfToday.getTime() - startOfDay.getTime()) / dayMs);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  if (d.getFullYear() === now.getFullYear()) return shortDate(d);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupByDay(items: DeliverableItem[]): { iso: string; items: DeliverableItem[] }[] {
  const map = new Map<string, DeliverableItem[]>();
  for (const it of items) {
    const key = (it.createdAt || '').slice(0, 10) || 'unknown';
    const bucket = map.get(key);
    if (bucket) bucket.push(it);
    else map.set(key, [it]);
  }
  return Array.from(map.entries()).map(([iso, items]) => ({ iso, items }));
}

interface AgentArtifactsTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed prompts — used when the user picks "+ New → <Type>".

const CREATION_SEEDS: Record<CreationKind, string> = {
  slides: 'Generate a slide deck summarizing ',
  chart: 'Create a chart showing ',
  data_export: "Export data from this agent's collections filtered by ",
};

const CREATION_ORDER: CreationKind[] = ['slides', 'chart', 'data_export'];

const FILTER_ORDER: ItemKind[] = ['slides', 'chart', 'data_export', 'briefing'];

// ─────────────────────────────────────────────────────────────────────────────
// Main

export function AgentArtifactsTab({
  task,
  artifacts,
}: AgentArtifactsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-open +New dropdown when arriving via ?new=1 (e.g. from Overview panel).
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setMenuOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const isDone = task.status === 'success' || task.completed_at != null;

  const briefingQuery = useQuery({
    queryKey: ['agent-briefing-meta', task.agent_id],
    queryFn: () => getBriefingMeta(task.agent_id),
    enabled: isDone,
    retry: false,
    staleTime: 60_000,
  });
  const briefing = briefingQuery.isSuccess && briefingQuery.data.exists
    ? briefingQuery.data
    : null;

  const { open: openBriefing } = useOpenBriefingShare(task.agent_id, task.title);

  const openArtifact = (artifact: ArtifactListItem) => {
    navigate(`/artifact/${artifact.artifact_id}`);
  };

  const handleNew = (kind: CreationKind) => {
    const seed = CREATION_SEEDS[kind];
    setSearchParams({ tab: 'chat', compose: seed }, { replace: false });
  };

  const items: DeliverableItem[] = useMemo(() => {
    const out: DeliverableItem[] = [];

    if (briefing) {
      out.push({
        id: `briefing-${task.agent_id}`,
        kind: 'briefing',
        title: task.title,
        subtitle: 'briefing',
        createdAt: briefing.generated_at ?? '',
        onOpen: () => { void openBriefing(); },
      });
    }

    artifacts.forEach((a) => {
      if (a.type === 'dashboard') return;
      const kind = artifactTypeToKind(a.type) as ItemKind | null;
      if (!kind) return;
      out.push({
        id: a.artifact_id,
        kind,
        title: a.title,
        subtitle: a.type.replace('_', ' '),
        createdAt: a.created_at,
        onOpen: () => openArtifact(a),
        artifact: a,
      });
    });

    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifacts, briefing, task.agent_id]);

  const counts: Record<ItemKind, number> = useMemo(() => {
    const acc: Record<ItemKind, number> = {
      briefing: 0,
      slides: 0,
      chart: 0,
      data_export: 0,
    };
    for (const it of items) acc[it.kind] += 1;
    return acc;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filter !== 'all' && it.kind !== filter) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) || it.subtitle.toLowerCase().includes(q)
      );
    });
  }, [items, search, filter]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background relative">
      {/* Decorative background glow — matches Overview/Settings */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <AgentDetailHeader
        task={task}
        artifacts={artifacts}
        rightControls={
          <DeliverablesControls
            filter={filter}
            onFilterChange={setFilter}
            counts={counts}
            search={search}
            onSearchChange={setSearch}
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
            onNew={handleNew}
          />
        }
      />

      <div className="flex-1 overflow-y-auto z-10 px-6 pb-8 pt-5">
        {items.length === 0 ? (
          <EmptyState onNew={handleNew} menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="mb-3 h-8 w-8 opacity-15" />
            <p className="text-sm text-muted-foreground">No deliverables match your filters</p>
          </div>
        ) : (
          <div className="space-y-14">
            {groupByDay(filtered).map(({ iso, items: dayItems }, sectionIdx) => (
              <DaySection
                key={iso}
                label={formatDayLabel(iso)}
                items={dayItems}
                isFirst={sectionIdx === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-nav: filter chips + search + "+ New" button.

interface DeliverablesControlsProps {
  filter: FilterKind;
  onFilterChange: (f: FilterKind) => void;
  counts: Record<ItemKind, number>;
  search: string;
  onSearchChange: (s: string) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onNew: (kind: CreationKind) => void;
}

function DeliverablesControls({
  filter,
  onFilterChange,
  counts,
  search,
  onSearchChange,
  menuOpen,
  onMenuOpenChange,
  onNew,
}: DeliverablesControlsProps) {
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const visibleFilters = FILTER_ORDER.filter((k) => counts[k] > 0);

  return (
    <div className="flex items-center gap-2">
      {/* Filter chips — horizontally scrollable if they overflow */}
      <div className="flex max-w-[420px] items-center gap-1.5 overflow-x-auto pr-1">
        <FilterChip
          active={filter === 'all'}
          onClick={() => onFilterChange('all')}
          label="All"
          count={totalCount}
        />
        {visibleFilters.map((k) => (
          <FilterChip
            key={k}
            active={filter === k}
            onClick={() => onFilterChange(k)}
            label={KIND_VISUALS[k].labelPlural}
            count={counts[k]}
          />
        ))}
      </div>

      {/* Search */}
      <div className="relative w-44">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="h-8 pl-8 text-xs"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* + New */}
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Create deliverable
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CREATION_ORDER.map((kind) => {
            const visual =
              kind === 'slides' ? KIND_VISUALS.slides : KIND_VISUALS[kind];
            const Icon = visual.icon;
            return (
              <DropdownMenuItem
                key={kind}
                onClick={() => onNew(kind)}
                className="gap-2.5"
              >
                <Icon className={cn('h-4 w-4', visual.iconTint)} />
                <span>{visual.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'tabular-nums text-[10px]',
          active ? 'text-primary/70' : 'text-muted-foreground/60',
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state

function EmptyState({
  onNew,
  menuOpen,
  onMenuOpenChange,
}: {
  onNew: (kind: CreationKind) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-20">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/10 bg-gradient-to-br from-violet-500/20 to-violet-500/5">
          <Sparkles className="h-7 w-7 text-violet-500/60" />
        </div>
        <div>
          <p className="font-heading text-base font-semibold tracking-tight text-foreground">
            No deliverables yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Briefings, dashboards, slide decks and data exports from this agent will appear
            here. You can also create one now — describe what you want and the agent will
            build it using this agent's sources.
          </p>
        </div>
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create a deliverable
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52">
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Create deliverable
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CREATION_ORDER.map((kind) => {
              const visual = KIND_VISUALS[kind];
              const Icon = visual.icon;
              return (
                <DropdownMenuItem
                  key={kind}
                  onClick={() => onNew(kind)}
                  className="gap-2.5"
                >
                  <Icon className={cn('h-4 w-4', visual.iconTint)} />
                  <span>{visual.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day section + bento grid

function DaySection({
  label,
  items,
  isFirst,
}: {
  label: string;
  items: DeliverableItem[];
  isFirst: boolean;
}) {
  const sizes = useMemo(() => computeSizes(items), [items]);
  return (
    <section>
      <div className={cn('mb-6 flex items-baseline gap-3', !isFirst && 'pt-2')}>
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {label}
        </h2>
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60 tabular-nums">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className="grid grid-flow-dense auto-rows-[220px] grid-cols-2 gap-5 sm:grid-cols-6 lg:grid-cols-12">
        {items.map((it, i) => (
          <DeliverableCard key={it.id} item={it} size={sizes[i]} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards — one per kind

function DeliverableCard({ item, size }: { item: DeliverableItem; size: CardSize }) {
  switch (item.kind) {
    case 'chart':
      return <ChartCard item={item} size={size} />;
    case 'slides':
      return <SlidesCard item={item} size={size} />;
    case 'data_export':
      return <ExportCard item={item} size={size} />;
    case 'briefing':
      return <BasicCard item={item} size={size} />;
  }
}

function CardShell({
  kind,
  size,
  onClick,
  preview,
  item,
  subtype,
}: {
  kind: ItemKind;
  size: CardSize;
  onClick: () => void;
  preview: React.ReactNode;
  item: DeliverableItem;
  subtype?: string;
}) {
  const visual = KIND_VISUALS[kind];
  const Icon = visual.icon;
  const titleSize = TALL_SIZES.has(size) ? 'text-sm' : 'text-[13px]';
  return (
    <button
      onClick={onClick}
      className={cn(
        SIZE_CLASSES[size],
        'group relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-all',
        'hover:border-primary/40 hover:shadow-lg',
        'animate-in fade-in zoom-in-95 duration-300',
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-1.5 pt-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate font-heading font-medium tracking-tight text-foreground',
              titleSize,
            )}
          >
            {item.title}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-muted-foreground/70">
            <Icon className={cn('h-3 w-3 shrink-0', visual.iconTint)} />
            <span className="font-medium uppercase tracking-wider">
              {visual.label}
              {subtype && (
                <>
                  <span className="mx-1 opacity-50">·</span>
                  <span>{subtype}</span>
                </>
              )}
            </span>
            <span className="opacity-50">·</span>
            <span>{timeAgo(item.createdAt)}</span>
          </p>
        </div>
        <ArtifactBadges artifact={item.artifact} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{preview}</div>
    </button>
  );
}

function ArtifactBadges({ artifact }: { artifact?: ArtifactListItem }) {
  if (!artifact) return null;
  if (!artifact.favorited && !artifact.shared) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 pt-0.5">
      {artifact.favorited && (
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
      )}
      {artifact.shared && (
        <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

function FallbackPreview({ kind }: { kind: ItemKind }) {
  const visual = KIND_VISUALS[kind];
  const Icon = visual.icon;
  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center bg-gradient-to-br',
        visual.tileGradient,
      )}
    >
      <Icon className={cn('h-12 w-12', visual.iconTint)} />
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Chart: lazy-load payload, render mini SocialChartWidget ────────────────

function ChartCard({ item, size }: { item: DeliverableItem; size: CardSize }) {
  const artifactId = item.artifact?.artifact_id;
  const { data, isLoading } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => getArtifact(artifactId!),
    enabled: !!artifactId,
    staleTime: Infinity,
  });

  const chartType = (data?.payload.chart_type as string | undefined) ?? undefined;
  const chartData = (data?.payload.data ?? {}) as Record<string, unknown>;
  const barOrientation = (data?.payload.bar_orientation as string | undefined) ?? 'horizontal';
  const stacked = (data?.payload.stacked as boolean | undefined) ?? true;

  const chartJsTypes = new Set(['bar', 'line', 'pie', 'doughnut']);
  const canRenderMini = chartType && chartJsTypes.has(chartType);
  const subtype = (item.artifact?.chart_type ?? chartType)
    ? capitalize((item.artifact?.chart_type ?? chartType) as string)
    : undefined;

  return (
    <CardShell
      kind="chart"
      size={size}
      item={item}
      subtype={subtype}
      onClick={item.onOpen}
      preview={
        canRenderMini ? (
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/8 to-transparent p-2">
            <SocialChartWidget
              chartType={chartType as SocialChartType}
              data={toWidgetData(chartData)}
              barOrientation={barOrientation as 'horizontal' | 'vertical'}
              stacked={stacked}
            />
          </div>
        ) : isLoading ? (
          <FallbackPreview kind="chart" />
        ) : chartType === 'number' ? (
          <NumberPreview data={chartData} />
        ) : chartType === 'table' ? (
          <TablePreview data={chartData} />
        ) : (
          <FallbackPreview kind="chart" />
        )
      }
    />
  );
}

function toWidgetData(raw: Record<string, unknown>): WidgetData {
  return {
    labels: raw.labels as string[] | undefined,
    values: raw.values as number[] | undefined,
    value: raw.value as number | undefined,
    timeSeries: (raw.timeSeries ?? raw.time_series) as WidgetData['timeSeries'],
    groupedTimeSeries: (raw.groupedTimeSeries ?? raw.grouped_time_series) as WidgetData['groupedTimeSeries'],
    groupedCategorical: (raw.groupedCategorical ?? raw.grouped_categorical) as WidgetData['groupedCategorical'],
  };
}

function NumberPreview({ data }: { data: Record<string, unknown> }) {
  const value = data.value as number | undefined;
  const label = data.label as string | undefined;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-violet-500/15 to-transparent">
      <span className="font-heading text-3xl font-bold tabular-nums text-foreground">
        {value != null ? formatNumber(value) : '—'}
      </span>
      {label && (
        <span className="mt-1 truncate px-3 text-[11px] text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

function TablePreview({ data }: { data: Record<string, unknown> }) {
  const columns = ((data.columns ?? []) as string[]).slice(0, 3);
  const rows = ((data.rows ?? []) as unknown[]).slice(0, 3);
  if (!columns.length) return <FallbackPreview kind="chart" />;
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent p-2">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-border/40">
            {columns.map((c) => (
              <th key={c} className="truncate px-1.5 py-1 text-left font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const cells = Array.isArray(row)
              ? row
              : columns.map((c) => (row as Record<string, unknown>)[c]);
            return (
              <tr key={i} className="border-b border-border/20 last:border-0">
                {cells.slice(0, 3).map((cell, j) => (
                  <td key={j} className="truncate px-1.5 py-1 text-foreground/80">
                    {typeof cell === 'number' ? formatNumber(cell) : String(cell ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Slides: lazy-load payload to show slide count ──────────────────────────

function SlidesCard({ item, size }: { item: DeliverableItem; size: CardSize }) {
  const artifactId = item.artifact?.artifact_id;
  const { data } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => getArtifact(artifactId!),
    enabled: !!artifactId,
    staleTime: Infinity,
  });
  const slideCount = data?.payload.slide_count as number | undefined;

  return (
    <CardShell
      kind="slides"
      size={size}
      item={item}
      onClick={item.onOpen}
      preview={
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/15 via-transparent to-amber-500/5 p-3">
          <SlideCoverPreview title={item.title} slideCount={slideCount} />
        </div>
      }
    />
  );
}

function SlideCoverPreview({
  title,
  slideCount,
}: {
  title: string;
  slideCount: number | undefined;
}) {
  return (
    <div className="relative flex h-full w-full flex-col justify-between rounded-md border border-amber-500/20 bg-gradient-to-br from-background to-amber-50/40 p-4 shadow-sm dark:to-amber-950/10">
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-md bg-gradient-to-b from-amber-400 to-amber-600" />
      <div className="ml-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-amber-700/70 dark:text-amber-400/70">
          Presentation
        </p>
      </div>
      <div className="ml-2 flex-1 flex items-center">
        <p className="line-clamp-3 font-heading text-base font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </p>
      </div>
      <div className="ml-2 flex items-end justify-between">
        <div className="h-0.5 w-10 rounded-full bg-amber-500/40" />
        {slideCount != null && (
          <span className="text-[10px] font-medium tabular-nums text-amber-700/60 dark:text-amber-400/60">
            {slideCount} {slideCount === 1 ? 'slide' : 'slides'}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Data export: row × column counts ───────────────────────────────────────

function ExportCard({ item, size }: { item: DeliverableItem; size: CardSize }) {
  const artifactId = item.artifact?.artifact_id;
  const { data } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => getArtifact(artifactId!),
    enabled: !!artifactId,
    staleTime: Infinity,
  });
  const rowCount = data?.payload.row_count as number | undefined;
  const columns = data?.payload.column_names as string[] | undefined;
  const rows = data?.payload.rows as unknown[] | undefined;

  return (
    <CardShell
      kind="data_export"
      size={size}
      item={item}
      onClick={item.onOpen}
      preview={
        rows && columns ? (
          <ExportTablePreview
            rows={rows}
            columns={columns}
            rowCount={rowCount}
          />
        ) : (
          <FallbackPreview kind="data_export" />
        )
      }
    />
  );
}

function ExportTablePreview({
  rows,
  columns,
  rowCount,
}: {
  rows: unknown[];
  columns: string[];
  rowCount: number | undefined;
}) {
  const visibleCols = columns.slice(0, 4);
  const visibleRows = rows.slice(0, 5);
  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-slate-500/8 to-transparent">
      <div className="flex-1 min-h-0 overflow-hidden px-3 pt-2">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/50">
              {visibleCols.map((c) => (
                <th
                  key={c}
                  className="truncate px-1.5 py-1 text-left font-medium uppercase tracking-wider text-muted-foreground/70"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const cells = visibleCols.map((c) =>
                (row as Record<string, unknown>)[c],
              );
              return (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  {cells.map((cell, j) => (
                    <td
                      key={j}
                      className="truncate px-1.5 py-1 text-foreground/85"
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="shrink-0 flex items-center justify-between border-t border-border/40 bg-background/60 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Table2 className="h-3 w-3" />
          <span className="tabular-nums">
            {columns.length} {columns.length === 1 ? 'column' : 'columns'}
          </span>
        </span>
        {rowCount != null && (
          <span className="tabular-nums">{formatNumber(rowCount)} rows</span>
        )}
      </div>
    </div>
  );
}

function formatCell(cell: unknown): string {
  if (cell == null) return '—';
  if (typeof cell === 'number') return formatNumber(cell);
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  const s = String(cell);
  return s.length > 28 ? s.slice(0, 28) + '…' : s;
}

// ─── Briefing: fake newspaper layout ────────────────────────────────────────

function BasicCard({ item, size }: { item: DeliverableItem; size: CardSize }) {
  if (item.kind === 'briefing') {
    return (
      <CardShell
        kind="briefing"
        size={size}
        item={item}
        onClick={item.onOpen}
        preview={<BriefingPreview createdAt={item.createdAt} />}
      />
    );
  }
  return (
    <CardShell
      kind={item.kind}
      size={size}
      item={item}
      onClick={item.onOpen}
      preview={<FallbackPreview kind={item.kind} />}
    />
  );
}

function BriefingPreview({ createdAt }: { createdAt: string }) {
  const dateLabel = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/12 via-indigo-500/3 to-transparent p-4">
      <div className="relative flex h-full w-full flex-col rounded-md border border-indigo-500/20 bg-background/80 p-4 shadow-sm">
        <div className="flex items-center justify-between border-b-2 border-indigo-500/40 pb-2">
          <span className="font-serif text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-600 dark:text-indigo-400">
            The Briefing
          </span>
          {dateLabel && (
            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              {dateLabel}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="h-2 w-[92%] rounded-full bg-indigo-500/45" />
          <div className="h-2 w-[68%] rounded-full bg-indigo-500/45" />
        </div>
        <div className="mt-3 aspect-[16/9] w-full rounded-sm bg-gradient-to-br from-indigo-500/25 via-indigo-500/15 to-transparent" />
        <div className="mt-3 space-y-1">
          <div className="h-1 w-full rounded-full bg-foreground/15" />
          <div className="h-1 w-full rounded-full bg-foreground/15" />
          <div className="h-1 w-[86%] rounded-full bg-foreground/15" />
          <div className="h-1 w-[72%] rounded-full bg-foreground/15" />
        </div>
        <div className="mt-auto flex items-center gap-2 pt-3">
          <div className="h-1 w-6 rounded-full bg-indigo-500/40" />
          <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
            Issue
          </span>
        </div>
      </div>
    </div>
  );
}

