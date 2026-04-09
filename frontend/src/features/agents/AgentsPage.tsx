import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Compass,
  FileText,
  Filter,
  LayoutGrid,
  List,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import { AgentDataExplorer } from './AgentDataExplorer.tsx';
import { AgentDetailDrawer, StatusBadge, RUNNABLE_STATUSES, STATUS_CONFIG, formatLastRun } from './AgentDetailDrawer.tsx';
import type { Agent, AgentStatus } from '../../api/endpoints/agents.ts';
import { deleteAgent, runAgent } from '../../api/endpoints/agents.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
import { formatSchedule } from '../../lib/constants.ts';
import { AgentCardGrid } from './AgentCardGrid.tsx';
import { AgentCard } from './AgentCard.tsx';
import { AgentCrest } from './AgentCrest.tsx';
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { useUIStore } from '../../stores/ui-store.ts';
import { ScrollArea, ScrollBar } from '../../components/ui/scroll-area.tsx';
import { cn } from '../../lib/utils.ts';

type ViewMode = 'table' | 'grid';
type SortField = 'last_run' | 'title' | 'status' | 'created_at' | 'next_run';
type SortDir = 'asc' | 'desc';

const loadViewMode = (): ViewMode => {
  try {
    const stored = localStorage.getItem('veille-agents-view');
    if (stored === 'grid' || stored === 'table') return stored;
  } catch { /* ignore */ }
  return 'table';
};

const ALL_STATUSES: AgentStatus[] = [
  'executing', 'monitoring', 'approved',
  'completed', 'paused', 'archived',
];

const STATUS_ROW_BORDER: Record<string, string> = {
  executing: 'border-l-amber-500',
  monitoring: 'border-l-violet-500',
  completed: 'border-l-green-500',
  approved: 'border-l-blue-500',
  paused: 'border-l-muted-foreground/40',
  archived: 'border-l-muted-foreground/30',
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

export function AgentsPage() {
  const navigate = useNavigate();
  const tasks = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const error = useAgentStore((s) => s.error);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<AgentStatus>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openScheduleOnDrawer, setOpenScheduleOnDrawer] = useState(false);
  const [explorerAgent, setExplorerAgent] = useState<Agent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
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
  const hasExecuting = useAgentStore((s) => s.agents.some((t) => t.status === 'executing'));
  useEffect(() => {
    if (!hasExecuting) return;
    const interval = setInterval(() => fetchAgents(), 15_000);
    return () => clearInterval(interval);
  }, [hasExecuting, fetchAgents]);

  const getLastRunTime = (agent: Agent): number => {
    const h = agent.run_history;
    if (!h?.length) return 0;
    return new Date(h[h.length - 1].run_at).getTime();
  };

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

  const filteredAgents = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
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
          return dir * a.status.localeCompare(b.status);
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

  const recentAgents = useMemo(() =>
    [...tasks]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 4),
    [tasks],
  );

  const toggleStatus = (status: AgentStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const handleRowClick = (agent: Agent) => {
    navigate(`/agents/${agent.task_id}`);
  };

  const handleScheduleFromTable = (agent: Agent) => {
    setSelectedAgent(agent);
    setOpenScheduleOnDrawer(true);
    setDrawerOpen(true);
  };

  const handleDelete = async (agent: Agent) => {
    try {
      await deleteAgent(agent.task_id);
      fetchAgents();
    } catch {
      // silent
    }
  };

  const handleRun = async (agent: Agent) => {
    try {
      await runAgent(agent.task_id);
      fetchAgents();
    } catch {
      // 409 or other error
    }
  };

  return (
    <div className="flex h-screen w-full overflow-x-hidden bg-background">
      <aside
        className="shrink-0 overflow-hidden border-r border-border bg-white dark:bg-[#0B1120]"
        style={{ width: sidebarCollapsed ? 48 : 280 }}
      >
        <AppSidebar />
      </aside>
      <div className="flex flex-1 flex-col overflow-x-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-base font-semibold text-foreground">Agents</h1>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Status
              {statusFilter.size > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {statusFilter.size}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ALL_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilter.has(s)}
                onCheckedChange={() => toggleStatus(s)}
              >
                <span className="flex items-center gap-2">
                  <span className={STATUS_CONFIG[s]?.color}>{STATUS_CONFIG[s]?.icon}</span>
                  {STATUS_CONFIG[s]?.label || s}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            {statusFilter.size > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setStatusFilter(new Set())}>
                  <X className="mr-2 h-3.5 w-3.5" />
                  Clear filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-md border">
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7 rounded-r-none', viewMode === 'table' && 'bg-accent')}
              onClick={() => handleViewModeChange('table')}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7 rounded-l-none', viewMode === 'grid' && 'bg-accent')}
              onClick={() => handleViewModeChange('grid')}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/?create=1')}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between px-6 py-3 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fetchAgents()}>
            Retry
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Recent Agents carousel */}
        {!search && statusFilter.size === 0 && tasks.length > 0 && (
          <div className="px-6 pt-4 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Recent Agents
            </h2>
            <ScrollArea className="w-full">
              <div className="flex gap-3 pb-3">
                {recentAgents.map((agent) => (
                  <div key={agent.task_id} className="w-[300px] shrink-0">
                    <AgentCard task={agent} compact onClick={() => handleRowClick(agent)} />
                  </div>
                ))}
                {/* New Agent card */}
                <div
                  className="w-[300px] shrink-0 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-accent/30 cursor-pointer transition-all min-h-[160px]"
                  onClick={() => navigate('/?create=1')}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 mb-2">
                    <Plus className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">New Agent</span>
                </div>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        )}

        {/* All Agents header */}
        {!isLoading && filteredAgents.length > 0 && (
          <div className="px-6 pt-3 pb-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              All Agents ({filteredAgents.length})
            </h2>
          </div>
        )}

        {isLoading ? (
          <div className="px-6 py-4 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 rounded border border-border/30 bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Search className="h-10 w-10 opacity-30 mb-3" />
            <p className="text-sm font-medium">
              {search || statusFilter.size > 0 ? 'No agents match your filters' : 'No agents yet'}
            </p>
            <p className="text-xs mt-1">
              {search || statusFilter.size > 0
                ? 'Try adjusting your search or filters'
                : 'Ask the AI to set up recurring monitoring or automate a scheduled report to create an agent'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-6">
            <AgentCardGrid
              tasks={filteredAgents}
              onAgentClick={handleRowClick}
            />
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-1.5">
            {/* Sort bar */}
            <div
              className="grid items-center gap-2 px-5 py-1.5 text-[11px] text-muted-foreground font-medium select-none"
              style={{ gridTemplateColumns: '1fr auto 6rem 6rem 6rem 6rem 5rem 5rem' }}
            >
              <span className="flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('title')}>
                Title <SortIcon field="title" />
              </span>
              <span className="w-36 text-center mr-11">Actions</span>
              <span className="flex items-center justify-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('status')}>
                Status <SortIcon field="status" />
              </span>
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />Schedule
              </span>
              <span className="flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('next_run')}>
                Next Run <SortIcon field="next_run" />
              </span>
              <span className="flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => handleSort('last_run')}>
                Last Run <SortIcon field="last_run" />
              </span>
              <span>Collections</span>
              <span>Artifacts</span>
            </div>

            {/* Agent rows — each in its own container */}
            {filteredAgents.map((task) => {
              const lastRun = task.run_history?.length
                ? task.run_history[task.run_history.length - 1]
                : null;
              const isExecuting = task.status === 'executing';
              const borderColor = STATUS_ROW_BORDER[task.status] ?? 'border-l-transparent';

              return (
                <div
                  key={task.task_id}
                  onClick={() => handleRowClick(task)}
                  className={cn(
                    'group relative grid items-center gap-2 rounded-lg border border-l-4 bg-card px-4 py-3 cursor-pointer transition-all overflow-hidden',
                    'hover:shadow-sm hover:border-primary/20',
                    borderColor,
                  )}
                  style={{ gridTemplateColumns: '1fr auto 6rem 6rem 6rem 6rem 5rem 5rem' }}
                >
                  {/* Shimmer overlay for executing */}
                  {isExecuting && (
                    <div className="absolute inset-0 pointer-events-none -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-amber-500/[0.04] to-transparent" aria-hidden />
                  )}

                  {/* Title + subtitle */}
                  <div className="flex items-center gap-3 min-w-0">
                    <AgentCrest id={task.task_id} />
                    {isExecuting && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-50" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {task.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
                        {isExecuting
                          ? 'Running...'
                          : `Ran ${formatLastRun(task.run_history)}`}
                        {task.schedule && ` · ${formatSchedule(task.schedule.frequency)}`}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-0.5 w-36 mr-11" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/agents/${task.task_id}?tab=chat`)}>
                            <MessageSquare className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Chat</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!RUNNABLE_STATUSES.includes(task.status)} onClick={() => handleRun(task)}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{task.task_type === 'recurring' ? 'Run Now' : 'Re-run'}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={task.task_type === 'recurring' || !['completed', 'approved'].includes(task.status)} onClick={() => handleScheduleFromTable(task)}>
                            <Timer className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Enable Schedule</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={(task.artifact_ids?.length ?? 0) === 0} onClick={() => navigate(`/agents/${task.task_id}?tab=artifacts`)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Artifacts</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={(task.collection_ids?.length ?? 0) === 0} onClick={() => navigate(`/agents/${task.task_id}?tab=explorer`)}>
                            <Compass className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Explorer</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => navigate(`/agents/${task.task_id}`)}>Overview</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/agents/${task.task_id}?tab=chat`)}>
                          <MessageSquare className="mr-2 h-3.5 w-3.5" /> Chat
                        </DropdownMenuItem>
                        {(task.artifact_ids?.length ?? 0) > 0 && (
                          <DropdownMenuItem onClick={() => navigate(`/agents/${task.task_id}?tab=artifacts`)}>
                            <FileText className="mr-2 h-3.5 w-3.5" /> Artifacts
                          </DropdownMenuItem>
                        )}
                        {(task.collection_ids?.length ?? 0) > 0 && (
                          <DropdownMenuItem onClick={() => navigate(`/agents/${task.task_id}?tab=explorer`)}>
                            <Compass className="mr-2 h-3.5 w-3.5" /> Explorer
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(task)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Status */}
                  <div className="flex justify-center"><StatusBadge status={task.status} /></div>

                  {/* Schedule */}
                  <div className="text-xs text-muted-foreground">
                    {task.task_type === 'recurring' && task.schedule
                      ? formatSchedule(task.schedule.frequency)
                      : '\u2014'}
                  </div>

                  {/* Next Run */}
                  <div className="text-xs text-muted-foreground">
                    {task.status === 'paused'
                      ? 'Paused'
                      : task.status === 'monitoring' && task.next_run_at
                        ? formatRelativeTime(task.next_run_at)
                        : '\u2014'}
                  </div>

                  {/* Last Run */}
                  <div className="text-xs text-muted-foreground">
                    {lastRun ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${lastRun.status === 'started' || lastRun.status === 'completed' ? 'bg-green-500' : 'bg-amber-500'}`} />
                        {formatLastRun(task.run_history)}
                      </span>
                    ) : '\u2014'}
                  </div>

                  {/* Collections */}
                  <div className="text-xs text-muted-foreground">{task.collection_ids?.length || 0}</div>

                  {/* Artifacts */}
                  <div className="text-xs text-muted-foreground">{task.artifact_ids?.length || 0}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <AgentDetailDrawer
        task={selectedAgent}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        autoOpenSchedule={openScheduleOnDrawer}
        onExploreData={setExplorerAgent}
      />

      <AgentDataExplorer
        task={explorerAgent}
        open={!!explorerAgent}
        onClose={() => setExplorerAgent(null)}
      />
      </div>
    </div>
  );
}
