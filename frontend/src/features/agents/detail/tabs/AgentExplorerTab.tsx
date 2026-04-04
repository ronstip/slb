import { useMemo } from 'react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { DashboardView } from '../../../studio/dashboard/DashboardView.tsx';
import { getExplorerDefaultLayout } from '../../../studio/dashboard/defaults-social-dashboard.ts';

interface TaskExplorerTabProps {
  task: Agent;
}

export function AgentExplorerTab({ task }: TaskExplorerTabProps) {
  const artifact = useMemo(() => ({
    id: task.task_id,
    type: 'dashboard' as const,
    title: task.title,
    collectionIds: task.collection_ids ?? [],
    collectionNames: {} as Record<string, string>,
    createdAt: new Date(task.created_at),
  }), [task.task_id, task.title, task.collection_ids, task.created_at]);

  if (!task.collection_ids?.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No collections to explore
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col w-full h-full overflow-hidden bg-background">
      <DashboardView artifact={artifact} standalone defaultLayout={getExplorerDefaultLayout()} />
    </div>
  );
}
