import { useMemo } from 'react';
import { Dialog, DialogContent } from '../../components/ui/dialog.tsx';
import { DashboardView } from '../studio/dashboard/DashboardView.tsx';
import { getExplorerDefaultLayout } from '../studio/dashboard/defaults-social-dashboard.ts';
import type { Agent } from '../../api/endpoints/agents.ts';

interface TaskDataExplorerProps {
  task: Agent | null;
  open: boolean;
  onClose: () => void;
}

export function AgentDataExplorer({ task, open, onClose }: TaskDataExplorerProps) {
  const artifact = useMemo(() => {
    if (!task) return null;
    return {
      id: task.task_id,
      type: 'dashboard' as const,
      title: task.title,
      collectionIds: task.collection_ids ?? [],
      collectionNames: {} as Record<string, string>,
      createdAt: new Date(task.created_at),
    };
  }, [task]);

  if (!artifact) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent showCloseButton={false} className="flex h-[95vh] w-[98vw] max-w-[1800px] sm:max-w-[1800px] flex-col gap-0 p-0 overflow-hidden">
        <DashboardView artifact={artifact} standalone defaultLayout={getExplorerDefaultLayout()} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
