import { useMemo, useEffect, useRef } from 'react';
import { Compass } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { DashboardView } from '../../../studio/dashboard/DashboardView.tsx';
import { getExplorerDefaultLayout, getNewLayoutStarterWidgets } from '../../../studio/dashboard/defaults-social-dashboard.ts';
import { useSocialDashboardStore } from '../../../studio/dashboard/social-dashboard-store.ts';
import { useExplorerLayoutStore } from '../../../../stores/explorer-layout-store.ts';
import { StatusBadge } from '../agent-status-utils.tsx';

interface TaskExplorerTabProps {
  task: Agent;
  activeLayoutId?: string | null;
  startInEditMode?: boolean;
}

export function AgentExplorerTab({ task, activeLayoutId = null, startInEditMode = false }: TaskExplorerTabProps) {
  const clearStartInEditMode = useExplorerLayoutStore((s) => s.clearStartInEditMode);
  const editModeTriggered = useRef(false);

  // Auto-enter edit mode for newly created layouts
  useEffect(() => {
    if (startInEditMode && !editModeTriggered.current) {
      editModeTriggered.current = true;
      // Small delay to ensure DashboardView has mounted and toolbar handlers are ready
      const timer = setTimeout(() => {
        useSocialDashboardStore.getState().setEditMode(true);
        clearStartInEditMode();
      }, 300);
      return () => clearTimeout(timer);
    }
    if (!startInEditMode) {
      editModeTriggered.current = false;
    }
  }, [startInEditMode, clearStartInEditMode]);

  const artifactId = activeLayoutId ?? task.agent_id;

  const artifact = useMemo(() => ({
    id: artifactId,
    type: 'dashboard' as const,
    title: task.title,
    collectionIds: task.collection_ids ?? [],
    collectionNames: {} as Record<string, string>,
    createdAt: new Date(task.created_at),
  }), [artifactId, task.title, task.collection_ids, task.created_at]);

  if (!task.collection_ids?.length) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-3 px-6">
          <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Compass className="h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">No collections to explore</p>
          <p className="text-xs">Collections will appear here once the agent runs.</p>
        </div>
      </div>
    );
  }

  // DashboardView's toolbar IS the header — inject status badge as adornment, suppress borders
  return (
    <div className="flex flex-1 flex-col w-full overflow-hidden bg-background">
      <DashboardView
        key={artifactId}
        artifact={artifact}
        standalone
        defaultLayout={activeLayoutId ? getNewLayoutStarterWidgets() : getExplorerDefaultLayout()}
        titleAdornment={<StatusBadge status={task.status} />}
        noBorder
      />
    </div>
  );
}
