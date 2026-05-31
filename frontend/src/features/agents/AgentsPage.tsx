import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Compass,
  FileText,
  Filter,
  LayoutGrid,
  List,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Timer,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import { RUNNABLE_STATUSES, StatusBadge, formatLastRun } from './detail/agent-status-utils.tsx';

// Lazy-load heavy panels — they're only rendered after the user clicks a row
// (drawer) or "Explore data" (dashboard). Eagerly importing them pulls in
// recharts, chart.js, react-grid-layout, jspdf, html2canvas, react-markdown,
// and the entire dashboard widget system into the agents-list bundle.
const AgentDataExplorer = lazy(() =>
  import('./AgentDataExplorer.tsx').then((m) => ({ default: m.AgentDataExplorer })),
);
const AgentDetailDrawer = lazy(() =>
  import('./AgentDetailDrawer.tsx').then((m) => ({ default: m.AgentDetailDrawer })),
);
import type { Agent, AgentStatus } from '../../api/endpoints/agents.ts';
import { runAgent, updateAgent as patchAgent } from '../../api/endpoints/agents.ts';
import { confirmAgentRun } from '../../components/confirm-dialog.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';
import { formatSchedule, PLATFORM_COLORS, PLATFORM_LABELS } from '../../lib/constants.ts';
import { AgentCardGrid } from './AgentCardGrid.tsx';
import { BotAvatar, UtilityTopBar } from '../../components/BrandElements.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { MobileHeader } from '../../components/MobileHeader.tsx';
import { MobileSidebar } from '../../components/MobileSidebar.tsx';
import { useIsMobile } from '../../hooks/useIsMobile.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { cn } from '../../lib/utils.ts';

type ViewMode = 'table' | 'grid';
type SortField = 'last_run' | 'title' | 'status' | 'created_at' | 'next_run';
type SortDir = 'asc' | 'desc';
type StatusFilterKey = 'all' | 'running' | 'success' | 'failed' | 'archived';

const loadViewMode = (): ViewMode => {
  try {
    const stored = localStorage.getItem('veille-agents-view');
    if (stored === 'grid' || stored === 'table') return stored;
  } catch { /* ignore */ }
  return 'table';
};

const FILTER_PILLS: { key: StatusFilterKey; label: string; status: AgentStatus | null }[] = [
  { key: 'all',      label: 'All',       status: null },
  { key: 'running',  label: 'Live',      status: 'running' },
  { key: 'success',  label: 'Completed', status: 'success' },
  { key: 'failed',   label: 'Failed',    status: 'failed' },
  { key: 'archived', label: 'Archived',  status: 'archived' },
];

const SORT_LABELS: Record<SortField, string> = {
  last_run:   'Last run',
  title:      'Title',
  status:     'Status',
  created_at: 'Created',
  next_run:   'Next run',
};

/** Relative time for future dates (e.g. "in 6h", "Tomorrow") */
function formatRelativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return 'now';
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 24) return `in ${diffH}h`;
  if (diffH < 48) return 'Tomorrow';
  const diffD = Math.round(diffMs / 86_400_000);
  return `in ${diffD}d`;
}

/** Coloured platform chip — used by the row's "Sources" cell. Renders the
 *  platform's official logo on a tile painted in its brand colour. */
function SourceMark({ platform }: { platform: string }) {
  const bg = PLATFORM_COLORS[platform] ?? '#6E665A';
  const label = PLATFORM_LABELS[platform] ?? platform;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white shadow-[0_1px_2px_rgba(15,12,8,0.18)] ring-1 ring-black/5"
          style={{ background: bg }}
        >
          <PlatformIcon platform={platform} className="h-3.5 w-3.5" color="#FFFFFF" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Stable seeded sparkline — decorative, distinct per agent. */
function MiniSparkline({ seed, color }: { seed: string; color: string }) {
  const points = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
    const n = 12;
    const arr: number[] = [];
    let x = h;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      arr.push((x % 100) / 100);
    }
    return arr;
  }, [seed]);
  const w = 84;
  const hh = 22;
  const path = points
    .map((v, i) => {
      const px = (i / (points.length - 1)) * w;
      const py = hh - v * (hh - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={hh} viewBox={`0 0 ${w} ${hh}`} className="shrink-0">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AgentsPage() {
  const navigate = useNavigate();
  const tasks = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const error = useAgentStore((s) => s.error);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const openWizardDrawer = useUIStore((s) => s.openWizardDrawer);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openScheduleOnDrawer, setOpenScheduleOnDrawer] = useState(false);
  const [explorerAgent, setExplorerAgent] = useState<Agent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  // The fixed-column table can't fit a phone; always show responsive cards there.
  const isMobile = useIsMobile();
  const effectiveViewMode: ViewMode = isMobile ? 'grid' : viewMode;
  const [sortField, setSortField] = useState<SortField>('last_run');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('veille-agents-view', mode);
  };

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Auto-refresh while any task is executing (use stable boolean selector to avoid infinite loop)
  const hasExecuting = useAgentStore((s) => s.agents.some((t) => t.status === 'running'));
  useEffect(() => {
    if (!hasExecuting) return;
    const interval = setInterval(() => fetchAgents(), 30_000);
    return () => clearInterval(interval);
  }, [hasExecuting, fetchAgents]);

  const getLastRunTime = (agent: Agent): number => new Date(agent.updated_at).getTime();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'title' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />;
  };

  // Counts per filter pill — based on the *unfiltered* agents list.
  const counts = useMemo(() => {
    const total = tasks.length;
    let running = 0, success = 0, failed = 0, archived = 0;
    for (const t of tasks) {
      if (t.status === 'running') running++;
      else if (t.status === 'success') success++;
      else if (t.status === 'failed') failed++;
      else if (t.status === 'archived') archived++;
    }
    return { all: total, running, success, failed, archived } as Record<StatusFilterKey, number>;
  }, [tasks]);

  const filteredAgents = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (statusFilter === 'all') {
        // Default view hides archived agents — same behaviour as before.
        if (t.status === 'archived') return false;
      } else {
        if (t.status !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q);
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sortField) {
        case 'title':
          return dir * a.title.localeCompare(b.title);
        case 'status':
          return dir * (a.status ?? 'idle').localeCompare(b.status ?? 'idle');
        case 'created_at':
          return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'next_run':
          return dir * ((a.next_run_at ? new Date(a.next_run_at).getTime() : 0) - (b.next_run_at ? new Date(b.next_run_at).getTime() : 0));
        case 'last_run':
        default:
          return dir * (getLastRunTime(a) - getLastRunTime(b));
      }
    });
  }, [tasks, statusFilter, search, sortField, sortDir]);

  // Agent counts for the eyebrow utility line.
  const totalAgents = tasks.filter((t) => t.status !== 'archived').length;
  const listeningNow = tasks.filter((t) => (t.status === 'running' || (t.agent_type === 'recurring' && !t.paused && t.status !== 'archived'))).length;

  const handleRowClick = (agent: Agent) => {
    navigate(`/agents/${agent.agent_id}`);
  };

  const handleScheduleFromTable = (agent: Agent) => {
    setSelectedAgent(agent);
    setOpenScheduleOnDrawer(true);
    setDrawerOpen(true);
  };

  const [archiveTarget, setArchiveTarget] = useState<Agent | null>(null);
  const [renameTarget, setRenameTarget] = useState<Agent | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleArchive = async (agent: Agent) => {
    try {
      await patchAgent(agent.agent_id, { status: 'archived' });
      fetchAgents();
    } catch {
      // silent
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleRestore = async (agent: Agent) => {
    try {
      await patchAgent(agent.agent_id, { status: 'success' });
      fetchAgents();
    } catch {
      // silent
    }
  };

  const handleRenameOpen = (agent: Agent) => {
    setRenameValue(agent.title);
    setRenameTarget(agent);
  };

  const handleRenameSave = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    try {
      await patchAgent(renameTarget.agent_id, { title: trimmed });
      fetchAgents();
    } catch {
      // silent
    } finally {
      setRenameTarget(null);
    }
  };

  const handleRun = async (agent: Agent) => {
    if (!(await confirmAgentRun(agent.title))) return;
    try {
      await runAgent(agent.agent_id);
      fetchAgents();
    } catch {
      // 409 or other error
    }
  };

  // Row column template — kept stable so the header line and each data row
  // stay perfectly aligned.
  // Agent | Sources | Status | Schedule | Last run | Trend | Actions
  const ROW_GRID = { gridTemplateColumns: 'minmax(260px,1fr) 168px 120px 120px 120px 100px 180px' } as const;

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex h-dvh w-full overflow-x-hidden bg-background">
      <aside
        className="hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar md:block"
        style={{ width: sidebarCollapsed ? 48 : 280 }}
      >
        <AppSidebar />
      </aside>

      <MobileSidebar>
        <AppSidebar />
      </MobileSidebar>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <MobileHeader />
        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-4 pb-14 md:px-10">
            {/* ── Top utility row — eyebrow with agent counts + bell + theme ── */}
            <div className="pt-8">
              <UtilityTopBar hasNotification={hasExecuting}>
                <span>
                  {totalAgents} {totalAgents === 1 ? 'agent' : 'agents'}
                  {listeningNow > 0 && <> · {listeningNow} listening now</>}
                </span>
              </UtilityTopBar>
            </div>

            {/* ── Page header ── */}
            <section className="mt-7">
              <h1 className="font-serif text-4xl font-light leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                All <span className="italic font-normal text-primary">agents</span>
              </h1>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                Every agent you've ever set running. Open one to see its latest report, or set a new one listening.
              </p>
            </section>

            {/* ── Toolbar ── */}
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="flex h-10 min-w-[260px] flex-1 max-w-[480px] items-center gap-2.5 rounded-md border border-border bg-card px-3.5">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  placeholder="Search agents, keywords, sources…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</span>
              </div>

              {/* Status filter pills (segmented) */}
              <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border border-border bg-card">
                {FILTER_PILLS.map((pill, i) => {
                  const active = statusFilter === pill.key;
                  return (
                    <button
                      key={pill.key}
                      onClick={() => setStatusFilter(pill.key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3.5 text-[12.5px] transition-colors',
                        i > 0 && 'border-l border-border',
                        active
                          ? 'bg-secondary font-semibold text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {pill.label}
                      <span className="font-mono text-[10px] text-muted-foreground">{counts[pill.key]}</span>
                    </button>
                  );
                })}
              </div>

              {/* Sort */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 gap-1.5 rounded-md px-3.5 text-[12.5px]">
                    <Filter className="h-3.5 w-3.5" />
                    Sort: {SORT_LABELS[sortField]}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
                    <DropdownMenuItem
                      key={f}
                      onClick={() => handleSort(f)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>{SORT_LABELS[f]}</span>
                      <SortIcon field={f} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="ml-auto flex items-center gap-3">
                {/* View toggle — hidden on mobile, where cards are forced */}
                <div className="hidden h-10 items-stretch overflow-hidden rounded-md border border-border bg-card md:inline-flex">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleViewModeChange('table')}
                        className={cn(
                          'flex w-11 items-center justify-center text-muted-foreground transition-colors',
                          viewMode === 'table' && 'bg-secondary text-foreground',
                        )}
                      >
                        <List className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>List</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleViewModeChange('grid')}
                        className={cn(
                          'flex w-11 items-center justify-center border-l border-border text-muted-foreground transition-colors',
                          viewMode === 'grid' && 'bg-secondary text-foreground',
                        )}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Cards</TooltipContent>
                  </Tooltip>
                </div>

                {/* New agent — dark "ink" button per template */}
                <button
                  onClick={openWizardDrawer}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
                >
                  <Plus className="h-4 w-4" />
                  New agent
                </button>
              </div>
            </div>

            {/* ── Error banner ── */}
            {error && (
              <div className="mt-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                <span>{error}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fetchAgents()}>
                  Retry
                </Button>
              </div>
            )}

            {/* ── Body ── */}
            <div className="mt-5">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 rounded-[14px] border border-border/30 bg-muted/20 animate-pulse" />
                  ))}
                </div>
              ) : filteredAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border bg-card/40 py-20 text-muted-foreground">
                  <Search className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">
                    {search || statusFilter !== 'all' ? 'No agents match your filters' : 'No agents yet'}
                  </p>
                  <p className="mt-1 text-xs">
                    {search || statusFilter !== 'all'
                      ? 'Try adjusting your search or filter'
                      : 'Ask the AI to set up recurring monitoring or automate a scheduled report to create an agent'}
                  </p>
                </div>
              ) : effectiveViewMode === 'grid' ? (
                <AgentCardGrid
                  tasks={filteredAgents}
                  onAgentClick={handleRowClick}
                />
              ) : (
                <div className="overflow-hidden rounded-[14px] border border-border bg-card">
                  {/* Header row */}
                  <div
                    className="grid items-center gap-3.5 border-b border-border bg-muted/40 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground"
                    style={ROW_GRID}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort('title')}
                      className="flex items-center gap-1 text-left hover:text-foreground"
                    >
                      Agent <SortIcon field="title" />
                    </button>
                    <span>Sources</span>
                    <button
                      type="button"
                      onClick={() => handleSort('status')}
                      className="flex items-center gap-1 text-left hover:text-foreground"
                    >
                      Status <SortIcon field="status" />
                    </button>
                    <span>Schedule</span>
                    <button
                      type="button"
                      onClick={() => handleSort('last_run')}
                      className="flex items-center gap-1 text-left hover:text-foreground"
                    >
                      Last run <SortIcon field="last_run" />
                    </button>
                    <span>Trend</span>
                    <span className="text-right">Actions</span>
                  </div>

                  {/* Data rows */}
                  {filteredAgents.map((task) => {
                    const isExecuting = task.status === 'running';
                    const lastRun = task.updated_at ? formatLastRun(task.updated_at) : '—';
                    const sources = task.data_scope?.sources?.map((s) => s.platform) ?? [];
                    const uniqueSources = Array.from(new Set(sources));

                    const subtitleParts: string[] = [];
                    if (task.schedule) subtitleParts.push(formatSchedule(task.schedule.frequency));
                    if (task.next_run_at && !task.paused) subtitleParts.push(`next ${formatRelativeTime(task.next_run_at)}`);
                    else if (task.paused) subtitleParts.push('Paused');
                    const subtitle = subtitleParts.join(' · ') || (task.agent_type === 'recurring' ? 'recurring' : 'one-shot');

                    return (
                      <div
                        key={task.agent_id}
                        onClick={() => handleRowClick(task)}
                        className="group relative grid cursor-pointer items-center gap-3.5 border-b border-border px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40"
                        style={ROW_GRID}
                      >
                        {isExecuting && (
                          <div
                            className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-primary/[0.06] to-transparent"
                            aria-hidden
                          />
                        )}

                        {/* Agent column */}
                        <div className="flex min-w-0 items-center gap-3.5">
                          <div className="flex w-10 shrink-0 justify-center">
                            <BotAvatar seed={task.agent_id} size={40} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">
                              {task.title}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                              {subtitle}
                            </div>
                          </div>
                        </div>

                        {/* Sources */}
                        <div className="flex items-center gap-1.5">
                          {uniqueSources.length === 0
                            ? <span className="text-[11px] text-muted-foreground">—</span>
                            : uniqueSources.slice(0, 5).map((p) => (
                              <SourceMark key={p} platform={p} />
                            ))}
                          {uniqueSources.length > 5 && (
                            <span className="font-mono text-[10px] text-muted-foreground">+{uniqueSources.length - 5}</span>
                          )}
                        </div>

                        {/* Status */}
                        <div>
                          <StatusBadge status={task.status} paused={task.paused} size="sm" />
                        </div>

                        {/* Schedule */}
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {task.agent_type === 'recurring' && task.schedule
                            ? formatSchedule(task.schedule.frequency)
                            : '—'}
                        </div>

                        {/* Last run */}
                        <div className="text-[12px] text-foreground/80">
                          {lastRun}
                        </div>

                        {/* Trend */}
                        <div>
                          <MiniSparkline seed={task.agent_id} color={`var(--chart-${(task.agent_id.charCodeAt(0) % 5) + 1})`} />
                          {/* fallback color via inline style — keeps the strokes within the chart palette */}
                        </div>

                        {/* Actions */}
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => navigate(`/agents/${task.agent_id}?tab=chat`)}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Chat</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={!RUNNABLE_STATUSES.includes(task.status)}
                                onClick={() => handleRun(task)}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{task.agent_type === 'recurring' ? 'Run now' : 'Re-run'}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={(task.artifact_ids?.length ?? 0) === 0}
                                onClick={() => navigate(`/agents/${task.agent_id}?tab=artifacts`)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Artifacts ({task.artifact_ids?.length ?? 0})</TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}`)}>Overview</DropdownMenuItem>
                              {(task.collection_ids?.length ?? 0) > 0 && (
                                <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}?tab=explorer`)}>
                                  <Compass className="mr-2 h-3.5 w-3.5" /> Explorer
                                </DropdownMenuItem>
                              )}
                              {task.agent_type !== 'recurring' && task.status === 'success' && (
                                <DropdownMenuItem onClick={() => handleScheduleFromTable(task)}>
                                  <Timer className="mr-2 h-3.5 w-3.5" /> Schedule
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleRenameOpen(task)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {task.status === 'archived' ? (
                                <DropdownMenuItem onClick={() => handleRestore(task)}>
                                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setArchiveTarget(task)}>
                                  <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Detail Drawer — only mounted once the user opens it, to keep the
            heavy drawer + StatsModal + TableModal out of the list-view bundle. */}
        {(drawerOpen || selectedAgent) && (
          <Suspense fallback={null}>
            <AgentDetailDrawer
              task={selectedAgent}
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              autoOpenSchedule={openScheduleOnDrawer}
              onExploreData={setExplorerAgent}
            />
          </Suspense>
        )}

        {/* Data Explorer — only mounted when explorerAgent is set. Lazy keeps
            the entire DashboardView + recharts + chart.js + react-grid-layout
            chunk off the agents-list critical path. */}
        {explorerAgent && (
          <Suspense fallback={null}>
            <AgentDataExplorer
              task={explorerAgent}
              open={!!explorerAgent}
              onClose={() => setExplorerAgent(null)}
            />
          </Suspense>
        )}

        {/* Archive confirmation dialog */}
        <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this agent?</AlertDialogTitle>
              <AlertDialogDescription>
                Any active data collection and scheduled runs will be stopped. You can restore the agent later from the archived filter.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => archiveTarget && handleArchive(archiveTarget)}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Rename dialog */}
        <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename Agent</DialogTitle>
            </DialogHeader>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSave(); }}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button size="sm" onClick={handleRenameSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
    </TooltipProvider>
  );
}
