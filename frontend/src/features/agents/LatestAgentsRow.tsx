import { useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { Agent } from '../../api/endpoints/agents.ts';
import { AgentCard } from './AgentCard.tsx';

interface LatestTasksRowProps {
  tasks: Agent[];
}

export function LatestAgentsRow({ tasks }: LatestTasksRowProps) {
  const navigate = useNavigate();

  const sorted = [...tasks]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 4);

  if (sorted.length === 0) return null;

  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-serif text-2xl font-normal leading-tight tracking-tight text-foreground">
          Recent <span className="italic text-primary">agents</span>
        </h2>
        <button
          type="button"
          onClick={() => navigate('/agents')}
          className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          View all
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((task) => (
          <div key={task.agent_id} className="flex min-w-0 flex-col">
            <AgentCard task={task} simple />
          </div>
        ))}
      </div>
    </div>
  );
}
