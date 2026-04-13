import { useEffect, useRef } from 'react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { useSessionStore } from '../../../../stores/session-store.ts';
import { useAgentStore } from '../../../../stores/agent-store.ts';
import { useUIStore } from '../../../../stores/ui-store.ts';
import { useCollectionPolling } from '../../../sources/useCollectionPolling.ts';
import { useCollectionsSync } from '../../../collections/useCollectionsSync.ts';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { StudioPanel } from '../../../studio/StudioPanel.tsx';
import { StatusBadge } from '../agent-status-utils.tsx';
import { CollectionSelector } from '../../../chat/CollectionSelector.tsx';
import { TaskSelector } from '../../../chat/TaskSelector.tsx';

interface TaskChatTabProps {
  task: Agent;
}

const STUDIO_COLLAPSED_W = 48;
const STUDIO_DEFAULT_W = 340;

export function AgentChatTab({ task }: TaskChatTabProps) {
  const restoredRef = useRef<string | null>(null);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);

  useCollectionsSync();
  useCollectionPolling();

  useEffect(() => {
    const sessionId = task.session_ids?.[0];
    if (!sessionId) return;

    const currentSessionId = useSessionStore.getState().activeSessionId;
    if (currentSessionId === sessionId) return;
    if (restoredRef.current === sessionId) return;

    restoredRef.current = sessionId;
    useSessionStore.getState().restoreSession(sessionId);
    useAgentStore.getState().setActiveAgent(task.agent_id);
  }, [task.agent_id, task.session_ids]);

  const sessionId = task.session_ids?.[0];
  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-3 px-6">
          <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No session associated with this agent yet.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: header + chat stacked */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header: name+status left, selectors right */}
        <div className="flex h-11 shrink-0 items-center gap-3 px-6">
          <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
          <StatusBadge status={task.status} />
          <div className="flex-1" />
          <CollectionSelector />
          <TaskSelector />
        </div>
        <ChatPanel hideHeader />
      </div>

      {/* Right: studio sidebar spans full height */}
      <aside
        className="shrink-0 overflow-hidden bg-card border-l border-border"
        style={{ width: studioPanelCollapsed ? STUDIO_COLLAPSED_W : STUDIO_DEFAULT_W }}
      >
        <StudioPanel />
      </aside>
    </div>
  );
}
