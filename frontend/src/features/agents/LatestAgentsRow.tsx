import { useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { Agent } from '../../api/endpoints/agents.ts';
import { AgentCard } from './AgentCard.tsx';
import { Button } from '../../components/ui/button.tsx';

interface LatestTasksRowProps {
  tasks: Agent[];
}

export function LatestAgentsRow({ tasks }: LatestTasksRowProps) {
  const navigate = useNavigate();

  const sorted = [...tasks]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  if (sorted.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Agents</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-xs text-muted-foreground hover:text-primary"
          onClick={() => navigate('/agents')}
        >
          View all agents
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-3">
        {sorted.map((task) => (
          <div key={task.task_id} className="flex-1 min-w-[160px] max-w-[280px]">
            <AgentCard task={task} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
