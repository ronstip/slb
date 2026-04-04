import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
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
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { useUIStore } from '../../stores/ui-store.ts';
import { UserMenu } from '../../components/UserMenu.tsx';
import { cn } from '../../lib/utils.ts';

type ViewMode = 'table' | 'grid';

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

  const filteredAgents = tasks
    .filter((t) => {
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      // Monitoring tasks first
      const aMonitoring = a.status === 'monitoring' ? 0 : 1;
      const bMonitoring = b.status === 'monitoring' ? 0 : 1;
      if (aMonitoring !== bMonitoring) return aMonitoring - bMonitoring;
      // Then by next_run_at ascending (nulls last)
      if (a.next_run_at && b.next_run_at) {
        const diff = new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime();
        if (diff !== 0) return diff;
      } else if (a.next_run_at) return -1;
      else if (b.next_run_at) return 1;
      // Then by created_at descending
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
      {/* Header with integrated filters */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-5">
        <span className="text-sm font-medium text-muted-foreground">Agents</span>

        <div className="flex flex-1 items-center gap-2">
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

        <div className="ml-auto flex items-center gap-1">
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
          <Button size="sm" className="h-7 text-xs ml-2" onClick={() => navigate('/')}>
            <Plus className="mr-1 h-3 w-3" />
            New Agent
          </Button>
          <UserMenu />
        </div>
      </div>
      </header>

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between px-6 py-3 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fetchAgents()}>
            Retry
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
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
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-[11px] text-muted-foreground font-medium">
                <th className="text-left px-6 py-2.5">Title</th>
                <th className="text-center px-3 py-2.5 w-36">Actions</th>
                <th className="text-left px-3 py-2.5 w-28">Status</th>
                <th className="text-left px-3 py-2.5 w-28">
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3" />Schedule</span>
                </th>
                <th className="text-left px-3 py-2.5 w-24">Next Run</th>
                <th className="text-left px-3 py-2.5 w-24">Last Run</th>
                <th className="text-left px-3 py-2.5 w-24">Collections</th>
                <th className="text-left px-3 py-2.5 w-24">Artifacts</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((task) => {
                const lastRun = task.run_history?.length
                  ? task.run_history[task.run_history.length - 1]
                  : null;

                return (
                  <tr
                    key={task.task_id}
                    onClick={() => handleRowClick(task)}
                    className="border-b border-border/40 cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-foreground truncate max-w-md">
                        {task.title}
                      </div>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!(task.session_id || task.primary_session_id)}
                                onClick={() => navigate(`/session/${task.session_id || task.primary_session_id}`)}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open Session</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!RUNNABLE_STATUSES.includes(task.status)}
                                onClick={() => handleRun(task)}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{task.task_type === 'recurring' ? 'Run Now' : 'Re-run'}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={task.task_type === 'recurring' || !['completed', 'approved'].includes(task.status)}
                                onClick={() => handleScheduleFromTable(task)}
                              >
                                <Timer className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Enable Schedule</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={(task.artifact_ids?.length ?? 0) === 0}
                                onClick={() => handleRowClick(task)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View Artifacts</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={(task.collection_ids?.length ?? 0) === 0}
                                onClick={() => setExplorerAgent(task)}
                              >
                                <Compass className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Explore Data</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleRowClick(task)}>
                              View Details
                            </DropdownMenuItem>
                            {(task.collection_ids?.length ?? 0) > 0 && (
                              <DropdownMenuItem onClick={() => setExplorerAgent(task)}>
                                <Compass className="mr-2 h-3.5 w-3.5" />
                                Explore Data
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(task)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.task_type === 'recurring' && task.schedule
                        ? formatSchedule(task.schedule.frequency)
                        : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.status === 'paused'
                        ? 'Paused'
                        : task.status === 'monitoring' && task.next_run_at
                          ? formatRelativeTime(task.next_run_at)
                          : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {lastRun ? (
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${lastRun.status === 'started' || lastRun.status === 'completed' ? 'bg-green-500' : 'bg-amber-500'}`} />
                          {formatLastRun(task.run_history)}
                        </span>
                      ) : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.collection_ids?.length || 0}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.artifact_ids?.length || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
