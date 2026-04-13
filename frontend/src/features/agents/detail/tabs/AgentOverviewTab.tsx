import {
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Database,
  FileText,
  Pencil,
  Play,
  Repeat,
  Square,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { Agent, AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { STATUS_ACCENT, StatusBadge, formatDate, formatLogTime } from '../agent-status-utils.tsx';
import { formatSchedule } from '../../../../lib/constants.ts';
import { Button } from '../../../../components/ui/button.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';

interface TaskOverviewTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  logs: AgentLogEntry[];
  onTabChange: (tab: DetailTab) => void;
  onOpenSchedule: () => void;
  onRun?: () => void;
  onStop?: () => void;
  canRun?: boolean;
}

export function AgentOverviewTab({ task, logs, onTabChange, onOpenSchedule, onRun, onStop, canRun }: TaskOverviewTabProps) {
  const collectionsCount = task.collection_ids?.length || 0;
  const artifactsCount = task.artifact_ids?.length || 0;
  const stepsCount = task.todos?.length || 0;
  const completedSteps = task.todos?.filter((t) => t.status === 'completed').length || 0;
  const progressPct = stepsCount > 0 ? Math.round((completedSteps / stepsCount) * 100) : null;

  const startDate = formatDate(task.created_at);
  const endDate = task.completed_at ? formatDate(task.completed_at) : null;
  const accentClass = STATUS_ACCENT[task.status] || 'bg-muted';

  const showScheduleBtn =
    task.agent_type !== 'recurring' && ['completed', 'approved'].includes(task.status);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Single unified header — no border, embedded in content */}
      <div className="flex h-11 shrink-0 items-center gap-3 px-6">
        <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
        <StatusBadge status={task.status} />
        <div className="flex-1" />
        {task.status === 'executing' && onStop && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={onStop}
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </Button>
        )}
        {canRun && onRun && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRun}>
            {task.agent_type === 'recurring' ? (
              <><Play className="h-3 w-3" />Run Now</>
            ) : (
              <><Repeat className="h-3 w-3" />Re-run</>
            )}
          </Button>
        )}
        {showScheduleBtn && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onOpenSchedule}>
            <CalendarClock className="h-3 w-3" />
            Schedule
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-8 space-y-5">

          {/* ── Hero card ── */}
          <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className={cn('h-1 w-full', accentClass)} />
            <div className="px-5 py-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {startDate}
                {endDate && <> → {endDate}</>}
                {!endDate && task.status === 'executing' && (
                  <span className="flex items-center gap-1 text-amber-500 font-medium">
                    <Zap className="h-3 w-3" /> Running
                  </span>
                )}
                {!endDate && task.status === 'monitoring' && (
                  <span className="text-violet-500 font-medium">· Monitoring</span>
                )}
                {task.agent_type === 'recurring' && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Repeat className="h-3 w-3" /> Recurring
                  </span>
                )}
              </p>
              {task.context_summary && (
                <p className="mt-2 text-sm text-muted-foreground">{task.context_summary}</p>
              )}
              {progressPct !== null && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">Progress</span>
                    <span className="text-[11px] font-medium tabular-nums">{progressPct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', accentClass)}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {completedSteps} of {stepsCount} steps complete
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: collectionsCount, label: 'Collections', icon: Database, color: 'text-blue-500', bg: 'bg-blue-500/10', onClick: () => onTabChange('collections') },
              { value: artifactsCount, label: 'Artifacts', icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10', onClick: () => artifactsCount > 0 && onTabChange('artifacts') },
              { value: stepsCount, label: 'Steps', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', onClick: undefined },
            ].map(({ value, label, icon: Icon, color, bg, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={!onClick}
                className={cn(
                  'group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all',
                  onClick ? 'hover:border-primary/30 hover:shadow-sm cursor-pointer' : 'cursor-default',
                )}
              >
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', bg)}>
                  <Icon className={cn('h-4.5 w-4.5', color)} />
                </div>
                <div>
                  <div className="text-2xl font-bold leading-none">{value}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
                </div>
              </button>
            ))}
          </div>

          {/* ── Schedule ── */}
          {task.agent_type === 'recurring' && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule</h3>
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {task.schedule ? formatSchedule(task.schedule.frequency) : 'No schedule set'}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenSchedule}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                </div>
                {task.next_run_at && task.status === 'monitoring' && (
                  <p className="text-xs text-muted-foreground border-t border-border pt-2">
                    Next run:{' '}
                    <span className="font-medium text-foreground">
                      {new Date(task.next_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                      {new Date(task.next_run_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                    </span>
                  </p>
                )}
                {/* Run history now available via listAgentRuns() API */}
              </div>
            </div>
          )}

          {/* ── Plan / Todos ── */}
          {task.todos && task.todos.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan</h3>
              <div className="rounded-xl border border-border bg-card divide-y divide-border/40">
                {task.todos.map((todo, i) => (
                  <div key={todo.id} className={cn('flex items-center gap-3 px-4 py-3', todo.status === 'completed' && 'opacity-60')}>
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
                      {i + 1}
                    </span>
                    {todo.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    ) : todo.status === 'in_progress' ? (
                      <Play className="h-4 w-4 shrink-0 text-amber-500 animate-pulse" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />
                    )}
                    <span className={cn('text-sm flex-1', todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground')}>
                      {todo.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recent Activity ── */}
          {logs.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
              <div className="rounded-xl border border-border bg-card divide-y divide-border/40">
                {logs.slice(0, 6).map((log, i) => {
                  const isLatest = i === 0 && task.status === 'executing';
                  return (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="mt-0.5 shrink-0">
                        {isLatest ? (
                          <CircleDot className="h-3.5 w-3.5 animate-pulse text-primary" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-muted-foreground/30" strokeWidth={2.5} />
                        )}
                      </div>
                      <span className={cn('flex-1 text-xs leading-relaxed', isLatest ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                        {log.message}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
                        {formatLogTime(log.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
