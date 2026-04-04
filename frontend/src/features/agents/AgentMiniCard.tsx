import { useNavigate } from 'react-router';
import { Database, FileText, CalendarClock } from 'lucide-react';
import type { Agent } from '../../api/endpoints/agents.ts';
import { StatusBadge } from './AgentDetailDrawer.tsx';
import { formatSchedule } from '../../lib/constants.ts';
import { Logo } from '../../components/Logo.tsx';

interface TaskMiniCardProps {
  task: Agent;
}

export function AgentMiniCard({ task }: TaskMiniCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    const sessionId = task.primary_session_id || task.session_id;
    if (sessionId) {
      navigate(`/session/${sessionId}`);
    } else {
      navigate(`/tasks`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-[240px] shrink-0 flex-col rounded-xl border bg-card overflow-hidden text-left transition-all hover:border-primary/30 hover:shadow-md"
    >
      {/* Thumbnail placeholder */}
      <div className="flex h-16 items-center justify-center bg-muted/20">
        <Logo size="sm" showText className="opacity-20" />
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="line-clamp-2 text-sm font-medium leading-tight text-foreground">
            {task.title}
          </h4>
        </div>

        <StatusBadge status={task.status} />

        <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-3 text-[11px] text-muted-foreground">
          {task.collection_ids.length > 0 && (
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              {task.collection_ids.length}
            </span>
          )}
          {task.artifact_ids.length > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {task.artifact_ids.length}
            </span>
          )}
          {task.schedule && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {formatSchedule(task.schedule.frequency)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
