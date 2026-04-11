import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, ChevronDown, ExternalLink } from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import type { Agent } from '../../api/endpoints/agents.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';

const STATUS_LABELS: Record<string, string> = {
  executing: 'Running',
  monitoring: 'Monitoring',
  completed: 'Done',
  approved: 'Approved',
  paused: 'Paused',
};

function AgentItem({ agent, isActive, onClick }: {
  agent: Agent;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      }`}
    >
      <span className="flex-1 truncate text-xs">{agent.title}</span>
      <Badge variant="outline" className="text-[9px] h-4 shrink-0">
        {STATUS_LABELS[agent.status] || agent.status}
      </Badge>
    </button>
  );
}

export function TaskSelector() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const activeAgent = useAgentStore((s) => s.activeAgent);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  useEffect(() => {
    if (agents.length === 0) fetchAgents();
  }, [agents.length, fetchAgents]);

  const visibleAgents = agents.filter((t) =>
    ['approved', 'executing', 'completed', 'monitoring', 'paused'].includes(t.status),
  );

  if (visibleAgents.length === 0 && !activeAgent) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
          <ClipboardList className="h-3 w-3" />
          {activeAgent ? (
            <span className="max-w-[160px] truncate">{activeAgent.title}</span>
          ) : (
            <span>Agents</span>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {activeAgentId && (
            <button
              onClick={() => setActiveAgent(null)}
              className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50"
            >
              Clear agent context
            </button>
          )}
          {visibleAgents.map((agent) => (
            <AgentItem
              key={agent.task_id}
              agent={agent}
              isActive={agent.task_id === activeAgentId}
              onClick={() => setActiveAgent(agent.task_id)}
            />
          ))}
        </div>
        <div className="border-t mt-2 pt-2">
          <button
            onClick={() => navigate('/agents')}
            className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50"
          >
            <ExternalLink className="h-3 w-3" />
            View all agents
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
