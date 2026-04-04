import { useNavigate } from 'react-router';
import {
  Compass,
  Database,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Pause,
  Play,
  Repeat,
  StopCircle,
  CalendarClock,
} from 'lucide-react';
import type { Agent } from '../../../api/endpoints/agents.ts';
import { RUNNABLE_STATUSES } from './agent-status-utils.tsx';
import { Logo } from '../../../components/Logo.tsx';
import { UserMenu } from '../../../components/UserMenu.tsx';
import { cn } from '../../../lib/utils.ts';

export type DetailTab = 'overview' | 'chat' | 'collections' | 'artifacts' | 'explorer';

const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Compass },
  { id: 'artifacts', label: 'Artifacts', icon: FileText },
  { id: 'collections', label: 'Collections', icon: Database },
];

interface AgentDetailSidebarProps {
  task: Agent;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  hasCollections?: boolean;
  hasArtifacts?: boolean;
  onRun: () => void;
  onStop: () => void;
  onPauseResume: () => void;
  onOpenSchedule: () => void;
}

export function AgentDetailSidebar({
  task,
  activeTab,
  onTabChange,
  hasCollections,
  hasArtifacts,
  onRun,
  onStop,
  onPauseResume,
  onOpenSchedule,
}: AgentDetailSidebarProps) {
  const navigate = useNavigate();
  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  return (
    <nav className="flex w-52 shrink-0 flex-col bg-card border-r border-border">
      {/* Top: Logo */}
      <div className="flex items-center px-3 py-3">
        <button onClick={() => navigate('/')} className="focus:outline-none">
          <Logo size="sm" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-0.5 px-3 py-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          const disabled =
            (id === 'explorer' && !hasCollections) ||
            (id === 'artifacts' && !hasArtifacts);

          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onTabChange(id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                isActive
                  ? 'bg-accent text-foreground font-medium'
                  : disabled
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border" />

      {/* Actions section */}
      {(task.status === 'executing' || canRun ||
        (task.task_type === 'recurring' && (task.status === 'monitoring' || task.status === 'paused')) ||
        (task.task_type !== 'recurring' && ['completed', 'approved'].includes(task.status))) && (
        <div className="flex flex-col gap-0.5 px-3">
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Actions
          </p>
          {task.status === 'executing' && (
            <button
              onClick={onStop}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <StopCircle className="h-4 w-4 shrink-0" />
              Stop
            </button>
          )}
          {canRun && (
            <button
              onClick={onRun}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {task.task_type === 'recurring' ? (
                <><Play className="h-4 w-4 shrink-0" />Run Now</>
              ) : (
                <><Repeat className="h-4 w-4 shrink-0" />Re-run</>
              )}
            </button>
          )}
          {task.task_type === 'recurring' && (task.status === 'monitoring' || task.status === 'paused') && (
            <button
              onClick={onPauseResume}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {task.status === 'monitoring' ? (
                <><Pause className="h-4 w-4 shrink-0" />Pause</>
              ) : (
                <><Play className="h-4 w-4 shrink-0" />Resume</>
              )}
            </button>
          )}
          {task.task_type !== 'recurring' && ['completed', 'approved'].includes(task.status) && (
            <button
              onClick={onOpenSchedule}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CalendarClock className="h-4 w-4 shrink-0" />
              Schedule
            </button>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom: User card */}
      <div className="border-t border-border px-3 py-3">
        <UserMenu />
      </div>
    </nav>
  );
}
