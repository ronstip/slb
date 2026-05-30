import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, X } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import type { SessionListItem } from '../../../../api/endpoints/sessions.ts';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { useSessionStore } from '../../../../stores/session-store.ts';
import { useAgentStore } from '../../../../stores/agent-store.ts';
import { useChatStore } from '../../../../stores/chat-store.ts';
import { useUIStore } from '../../../../stores/ui-store.ts';
import { useCollectionPolling } from '../../../sources/useCollectionPolling.ts';
import { useCollectionsSync } from '../../../collections/useCollectionsSync.ts';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { StudioPanel } from '../../../studio/StudioPanel.tsx';
import { ErrorBoundary } from '../../../../components/ErrorBoundary.tsx';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';
import { ChatHeaderControls } from './ChatHeaderControls.tsx';

interface AgentChatTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  agentSessions: SessionListItem[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onTabChange: (tab: DetailTab) => void;
  onRun?: () => void;
  onStop?: () => void;
  onOpenSchedule?: () => void;
  canRun?: boolean;
}

const STUDIO_COLLAPSED_W = 48;
const STUDIO_MIN_W = 280;
const STUDIO_MAX_W = 900;

export function AgentChatTab({
  task,
  artifacts,
  agentSessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  onTabChange,
  onRun,
  onStop,
  onOpenSchedule,
  canRun,
}: AgentChatTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get('session');
  const compose = searchParams.get('compose');
  const restoredRef = useRef<string | null>(null);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const studioPanelWidth = useUIStore((s) => s.studioPanelWidth);
  const setStudioPanelWidth = useUIStore((s) => s.setStudioPanelWidth);
  const collapseStudioPanel = useUIStore((s) => s.collapseStudioPanel);
  const [resizing, setResizing] = useState(false);

  // Search-in-chat state — local to this tab.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useCollectionsSync();
  useCollectionPolling();

  // Force-collapse the Workspace panel on chat tab entry — keeps the chat
  // surface focused. Users can still expand it from its rail handle.
  useEffect(() => {
    collapseStudioPanel();
  }, [collapseStudioPanel]);

  // Consume `compose` search param once — seed the chat composer then strip it
  // from the URL so refresh/back-nav doesn't re-apply it.
  useEffect(() => {
    if (!compose) return;
    useChatStore.getState().setPendingComposerText(compose);
    const next = new URLSearchParams(searchParams);
    next.delete('compose');
    setSearchParams(next, { replace: true });
  }, [compose, searchParams, setSearchParams]);

  useEffect(() => {
    if (urlSessionId) {
      const currentSessionId = useSessionStore.getState().activeSessionId;
      if (currentSessionId === urlSessionId) {
        useAgentStore.getState().setActiveAgent(task.agent_id, task.collection_ids);
        return;
      }
      if (restoredRef.current === urlSessionId) return;

      restoredRef.current = urlSessionId;
      useSessionStore
        .getState()
        .restoreSession(urlSessionId)
        .then(() => {
          useAgentStore.getState().setActiveAgent(task.agent_id, task.collection_ids);
        })
        .catch((err) => {
          restoredRef.current = null;
          console.error('Failed to restore session', urlSessionId, err);
        });
    } else {
      if (restoredRef.current === `new:${task.agent_id}`) return;
      restoredRef.current = `new:${task.agent_id}`;
      useSessionStore.getState().startNewAgentSession(task.agent_id);
      useAgentStore.getState().setActiveAgent(task.agent_id, task.collection_ids);
    }
  }, [task.agent_id, urlSessionId, task.collection_ids]);

  // Drag-to-resize the Workspace panel from its left edge.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = window.innerWidth - e.clientX;
      setStudioPanelWidth(Math.min(STUDIO_MAX_W, Math.max(STUDIO_MIN_W, next)));
    };
    const onUp = () => setResizing(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, setStudioPanelWidth]);

  const handleToggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: header + search bar + chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <AgentDetailHeader
          task={task}
          artifacts={artifacts}
          rightControls={
            <ChatHeaderControls
              task={task}
              agentSessions={agentSessions}
              activeSessionId={activeSessionId}
              onSessionSelect={onSessionSelect}
              onNewChat={onNewChat}
              searchOpen={searchOpen}
              onToggleSearch={handleToggleSearch}
              onRun={onRun}
              onStop={onStop}
              onOpenSchedule={onOpenSchedule}
              onGoToSettings={() => onTabChange('settings')}
              canRun={canRun}
            />
          }
        />

        {searchOpen && (
          <ChatSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onClose={handleToggleSearch}
          />
        )}

        <ErrorBoundary label="ChatPanel">
          <ChatPanel hideHeader searchQuery={searchQuery} />
        </ErrorBoundary>
      </div>

      {/* Right: Workspace sidebar — desktop only; the rail/resize UX doesn't
          translate to mobile, where chat needs the full width. */}
      <aside
        className="relative hidden shrink-0 overflow-hidden border-l border-border bg-card md:block"
        style={{ width: studioPanelCollapsed ? STUDIO_COLLAPSED_W : studioPanelWidth }}
      >
        {!studioPanelCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace panel"
            onMouseDown={(e) => {
              e.preventDefault();
              setResizing(true);
            }}
            className={`absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40 ${
              resizing ? 'bg-primary/60' : ''
            }`}
          />
        )}
        <ErrorBoundary label="StudioPanel">
          <StudioPanel />
        </ErrorBoundary>
      </aside>
    </div>
  );
}

interface ChatSearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}

function ChatSearchBar({ value, onChange, onClose }: ChatSearchBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/30 px-6 py-2">
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find in this chat..."
        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <button
        onClick={onClose}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Close search (Esc)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
