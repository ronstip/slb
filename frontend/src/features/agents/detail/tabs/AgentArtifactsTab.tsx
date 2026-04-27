import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Search, Sparkles, Table2, X } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import {
  getArtifact,
  type ArtifactListItem,
} from '../../../../api/endpoints/artifacts.ts';
import { getAgentBriefing } from '../../../../api/endpoints/briefings.ts';
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
import { formatNumber, timeAgo } from '../../../../lib/format.ts';
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
    queryKey: ['agent-briefing-exists', task.agent_id],
    queryFn: () => getAgentBriefing(task.agent_id),
    enabled: isDone,
    retry: false,
    staleTime: 60_000,
  });
  const briefing = briefingQuery.isSuccess ? briefingQuery.data : null;

  const openBriefing = () => {
    setSearchParams({ tab: 'briefing' }, { replace: true });
  };

  const openArtifact = (artifact: ArtifactListItem) => {
    navigate(`/library?artifact=${artifact.artifact_id}`);
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
        title: 'Briefing',
        subtitle: 'briefing',
        createdAt: briefing.generated_at,
        onOpen: openBriefing,
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
          <div className="mx-auto max-w-[1400px]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((it) => (
                <DeliverableCard key={it.id} item={it} />
              ))}
            </div>
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
// Cards — one per kind

function DeliverableCard({ item }: { item: DeliverableItem }) {
  switch (item.kind) {
    case 'chart':
      return <ChartCard item={item} />;
    case 'slides':
      return <SlidesCard item={item} />;
    case 'data_export':
      return <ExportCard item={item} />;
    case 'briefing':
      return <BasicCard item={item} />;
  }
}

function CardShell({
  kind,
  onClick,
  preview,
  children,
}: {
  kind: ItemKind;
  onClick: () => void;
  preview: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-all',
        'hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5',
        'animate-in fade-in zoom-in-95 duration-300',
      )}
    >
      <div className="relative h-36 overflow-hidden">{preview}</div>
      <div className="min-w-0 border-t border-border/40 p-3.5">
        {children}
        <KindFooter kind={kind} />
      </div>
    </button>
  );
}

function KindFooter({ kind }: { kind: ItemKind }) {
  const visual = KIND_VISUALS[kind];
  const Icon = visual.icon;
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Icon className={cn('h-3 w-3', visual.iconTint)} />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {visual.label}
      </span>
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

function CardTitle({ item }: { item: DeliverableItem }) {
  return (
    <>
      <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {timeAgo(item.createdAt)}
      </p>
    </>
  );
}

// ─── Chart: lazy-load payload, render mini SocialChartWidget ────────────────

function ChartCard({ item }: { item: DeliverableItem }) {
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

  return (
    <CardShell
      kind="chart"
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
    >
      <CardTitle item={item} />
    </CardShell>
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

function SlidesCard({ item }: { item: DeliverableItem }) {
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
      onClick={item.onOpen}
      preview={
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-500/20 via-amber-500/5 to-transparent">
          {slideCount != null ? (
            <>
              <span className="font-heading text-4xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {slideCount}
              </span>
              <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-amber-700/70 dark:text-amber-500/70">
                {slideCount === 1 ? 'slide' : 'slides'}
              </span>
            </>
          ) : (
            <FallbackPreview kind="slides" />
          )}
        </div>
      }
    >
      <CardTitle item={item} />
    </CardShell>
  );
}

// ─── Data export: row × column counts ───────────────────────────────────────

function ExportCard({ item }: { item: DeliverableItem }) {
  const artifactId = item.artifact?.artifact_id;
  const { data } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => getArtifact(artifactId!),
    enabled: !!artifactId,
    staleTime: Infinity,
  });
  const rowCount = data?.payload.row_count as number | undefined;
  const columns = data?.payload.column_names as string[] | undefined;

  return (
    <CardShell
      kind="data_export"
      onClick={item.onOpen}
      preview={
        rowCount != null ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-500/15 to-transparent">
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-2xl font-bold tabular-nums text-foreground">
                {formatNumber(rowCount)}
              </span>
              <span className="text-[11px] text-muted-foreground">rows</span>
            </div>
            {columns && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Table2 className="h-3 w-3" />
                <span className="tabular-nums">
                  {columns.length} {columns.length === 1 ? 'column' : 'columns'}
                </span>
              </div>
            )}
          </div>
        ) : (
          <FallbackPreview kind="data_export" />
        )
      }
    >
      <CardTitle item={item} />
    </CardShell>
  );
}

// ─── Briefing: fake newspaper layout ────────────────────────────────────────

function BasicCard({ item }: { item: DeliverableItem }) {
  if (item.kind === 'briefing') {
    return (
      <CardShell
        kind="briefing"
        onClick={item.onOpen}
        preview={<BriefingPreview />}
      >
        <CardTitle item={item} />
      </CardShell>
    );
  }
  return (
    <CardShell
      kind={item.kind}
      onClick={item.onOpen}
      preview={<FallbackPreview kind={item.kind} />}
    >
      <CardTitle item={item} />
    </CardShell>
  );
}

function BriefingPreview() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/12 via-indigo-500/3 to-transparent p-3">
      <div className="flex h-full flex-col gap-1.5">
        {/* Masthead */}
        <div className="flex items-center justify-between border-b border-indigo-500/20 pb-1">
          <span className="text-[8px] font-bold uppercase tracking-widest text-indigo-600/70 dark:text-indigo-400/70">
            Briefing
          </span>
          <div className="h-1 w-8 rounded-full bg-indigo-500/30" />
        </div>
        {/* Headline */}
        <div className="space-y-1">
          <div className="h-1.5 w-[85%] rounded-full bg-indigo-500/45" />
          <div className="h-1.5 w-[60%] rounded-full bg-indigo-500/45" />
        </div>
        {/* Body lines */}
        <div className="mt-0.5 space-y-1">
          <div className="h-0.5 w-full rounded-full bg-foreground/15" />
          <div className="h-0.5 w-full rounded-full bg-foreground/15" />
          <div className="h-0.5 w-[88%] rounded-full bg-foreground/15" />
          <div className="h-0.5 w-[72%] rounded-full bg-foreground/15" />
        </div>
        {/* Pull-quote tag */}
        <div className="mt-auto flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-indigo-500/30" />
          <div className="h-0.5 flex-1 rounded-full bg-foreground/15" />
        </div>
      </div>
    </div>
  );
}
