import {
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Play,
} from 'lucide-react';
import type { Agent, AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import { formatLogTime } from '../agent-status-utils.tsx';

interface TaskActivityTabProps {
  task: Agent;
  logs: AgentLogEntry[];
}

export function AgentActivityTab({ task, logs }: TaskActivityTabProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Activity Logs */}
        <div>
          <h2 className="text-sm font-semibold mb-4">Activity ({logs.length})</h2>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 italic">No activity recorded yet</p>
          ) : (
            <div className="space-y-1">
              {logs.map((log, i) => {
                const isLatest = i === 0 && task.status === 'executing';
                return (
                  <div key={log.id} className="flex items-start gap-3 py-1.5">
                    {isLatest ? (
                      <CircleDot className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-pulse text-primary" />
                    ) : (
                      <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/40" strokeWidth={2.5} />
                    )}
                    <span className={`text-sm leading-snug flex-1 ${isLatest ? 'text-foreground font-medium' : 'text-muted-foreground/70'}`}>
                      {log.message}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/40 tabular-nums">
                      {formatLogTime(log.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Plan / Todos */}
        {task.todos && task.todos.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-4">Plan ({task.todos.length} steps)</h2>
            <div className="space-y-2">
              {task.todos.map((todo) => (
                <div key={todo.id} className="flex items-center gap-2.5 text-sm">
                  {todo.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : todo.status === 'in_progress' ? (
                    <Play className="h-4 w-4 text-amber-500 shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  )}
                  <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
