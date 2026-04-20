import type { Agent } from '../../../../api/endpoints/agents.ts';
import { TopicsFeed } from '../../../studio/TopicsFeed.tsx';

interface AgentTopicsTabProps {
  task: Agent;
}

export function AgentTopicsTab({ task }: AgentTopicsTabProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-muted">
      <TopicsFeed agentId={task.agent_id} />
    </div>
  );
}
