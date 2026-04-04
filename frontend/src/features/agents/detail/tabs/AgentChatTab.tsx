import { useEffect, useRef } from 'react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { useSessionStore } from '../../../../stores/session-store.ts';
import { useAgentStore } from '../../../../stores/agent-store.ts';
import { useUIStore } from '../../../../stores/ui-store.ts';
import { useCollectionPolling } from '../../../sources/useCollectionPolling.ts';
import { useCollectionsSync } from '../../../collections/useCollectionsSync.ts';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { StudioPanel } from '../../../studio/StudioPanel.tsx';

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
    const sessionId = task.primary_session_id || task.session_id;
    if (!sessionId) return;

    // Only restore if we haven't already restored this session
    const currentSessionId = useSessionStore.getState().activeSessionId;
    if (currentSessionId === sessionId) return;
    if (restoredRef.current === sessionId) return;

    restoredRef.current = sessionId;
    useSessionStore.getState().restoreSession(sessionId);
    useAgentStore.getState().setActiveAgent(task.task_id);
  }, [task.task_id, task.session_id, task.primary_session_id]);

  const sessionId = task.primary_session_id || task.session_id;
  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No session associated with this agent yet.
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <ChatPanel />
      <aside
        className="shrink-0 overflow-hidden bg-card border-l"
        style={{ width: studioPanelCollapsed ? STUDIO_COLLAPSED_W : STUDIO_DEFAULT_W }}
      >
        <StudioPanel />
      </aside>
    </div>
  );
}
