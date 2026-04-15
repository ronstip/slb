import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Archive,
  ArchiveRestore,
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
  Pencil,
  Play,
  Plus,
  Search,
  Timer,
  X,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import { AgentDataExplorer } from './AgentDataExplorer.tsx';
import { AgentDetailDrawer, StatusBadge, RUNNABLE_STATUSES, STATUS_CONFIG, formatLastRun } from './AgentDetailDrawer.tsx';
import type { Agent, AgentStatus } from '../../api/endpoints/agents.ts';
import { runAgent, updateAgent as patchAgent } from '../../api/endpoints/agents.ts';
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
import { Badge } from '../../components/ui/badge.tsx';
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
  'running', 'success', 'failed', 'archived',
];

const STATUS_ROW_BORDER: Record<string, string> = {
  running: 'border-l-amber-500',
  success: 'border-l-green-500',
  failed: 'border-l-destructive',
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
  const hasExecuting = useAgentStore((s) => s.agents.some((t) => t.status === 'running'));
  useEffect(() => {
    if (!hasExecuting) return;
    const interval = setInterval(() => fetchAgents(), 30_000);
    return () => clearInterval(interval);
  }, [hasExecuting, fetchAgents]);

  const getLastRunTime = (agent: Agent): number => {
    return new Date(agent.updated_at).getTime();
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
      // Hide archived by default unless explicitly filtered
      if (statusFilter.size === 0 && t.status === 'archived') return false;
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
      .filter((t) => t.status !== 'archived')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 4),
    [tasks],
  );

  const toggleStatus = (status: AgentStatus) => {
    setStatusFilter((prev) => {
      // When no explicit filter is set, all non-archived statuses are implicitly active.
      // Toggling from this state should behave as if all non-archived were checked.
      if (prev.size === 0) {
        if (status === 'archived') {
          // Turning on archived → show everything
          return new Set(ALL_STATUSES);
        }
        // Turning off a non-archived status → explicit filter with everything except that one and archived
        const next = new Set(ALL_STATUSES.filter((s) => s !== 'archived' && s !== status));
        return next;
      }
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      // If the resulting set matches "all non-archived", collapse back to empty (default)
      const allNonArchived = ALL_STATUSES.filter((s) => s !== 'archived');
      if (allNonArchived.every((s) => next.has(s)) && !next.has('archived')) {
        return new Set();
      }
      return next;
    });
  };

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
    try {
      await runAgent(agent.agent_id);
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
                checked={statusFilter.size === 0 ? s !== 'archived' : statusFilter.has(s)}
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
                  <div key={agent.agent_id} className="w-[300px] shrink-0">
                    <AgentCard task={agent} compact skipThumbnails onClick={() => handleRowClick(agent)} />
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
              const lastRun = task.updated_at ? { run_at: task.updated_at, status: task.status } : null;
              const isExecuting = task.status === 'running';
              const borderColor = STATUS_ROW_BORDER[task.status] ?? 'border-l-transparent';

              return (
                <div
                  key={task.agent_id}
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
                    <AgentCrest id={task.agent_id} />
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
                          : `Ran ${formatLastRun(task.updated_at)}`}
                        {task.schedule && ` · ${formatSchedule(task.schedule.frequency)}`}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-0.5 w-36 mr-11" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/agents/${task.agent_id}?tab=chat`)}>
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
                        <TooltipContent>{task.agent_type === 'recurring' ? 'Run Now' : 'Re-run'}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={task.agent_type === 'recurring' || task.status !== 'success'} onClick={() => handleScheduleFromTable(task)}>
                            <Timer className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Enable Schedule</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={(task.artifact_ids?.length ?? 0) === 0} onClick={() => navigate(`/agents/${task.agent_id}?tab=artifacts`)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Artifacts</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={(task.collection_ids?.length ?? 0) === 0} onClick={() => navigate(`/agents/${task.agent_id}?tab=explorer`)}>
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
                        <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}`)}>Overview</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}?tab=chat`)}>
                          <MessageSquare className="mr-2 h-3.5 w-3.5" /> Chat
                        </DropdownMenuItem>
                        {(task.artifact_ids?.length ?? 0) > 0 && (
                          <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}?tab=artifacts`)}>
                            <FileText className="mr-2 h-3.5 w-3.5" /> Artifacts
                          </DropdownMenuItem>
                        )}
                        {(task.collection_ids?.length ?? 0) > 0 && (
                          <DropdownMenuItem onClick={() => navigate(`/agents/${task.agent_id}?tab=explorer`)}>
                            <Compass className="mr-2 h-3.5 w-3.5" /> Explorer
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

                  {/* Status */}
                  <div className="flex justify-center"><StatusBadge status={task.status} paused={task.paused} /></div>

                  {/* Schedule */}
                  <div className="text-xs text-muted-foreground">
                    {task.agent_type === 'recurring' && task.schedule
                      ? formatSchedule(task.schedule.frequency)
                      : '\u2014'}
                  </div>

                  {/* Next Run */}
                  <div className="text-xs text-muted-foreground">
                    {task.status === 'paused'
                      ? 'Paused'
                      : task.next_run_at
                        ? formatRelativeTime(task.next_run_at)
                        : '\u2014'}
                  </div>

                  {/* Last Run */}
                  <div className="text-xs text-muted-foreground">
                    {lastRun ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${lastRun.status === 'success' ? 'bg-green-500' : lastRun.status === 'failed' ? 'bg-destructive' : 'bg-amber-500'}`} />
                        {formatLastRun(task.updated_at)}
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
  );
}
