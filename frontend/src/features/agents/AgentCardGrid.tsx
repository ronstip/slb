import type { Agent } from '../../api/endpoints/agents.ts';
import { AgentCard } from './AgentCard.tsx';

interface AgentCardGridProps {
  tasks: Agent[];
  onAgentClick?: (agent: Agent) => void;
}

export function AgentCardGrid({ tasks, onAgentClick }: AgentCardGridProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No agents found
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tasks.map((task) => (
        <AgentCard
          key={task.agent_id}
          task={task}
          onClick={onAgentClick ? () => onAgentClick(task) : undefined}
        />
      ))}
    </div>
  );
}
