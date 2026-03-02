import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { TopBar } from './TopBar.tsx';
import { useUIStore } from '../stores/ui-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { ChatPanel } from '../features/chat/ChatPanel.tsx';
import { SessionsPanel } from '../features/sessions/SessionsPanel.tsx';
import { StudioPanel } from '../features/studio/StudioPanel.tsx';
import { CollectionModal } from '../features/sources/CollectionModal.tsx';
import { useCollectionPolling } from '../features/sources/useCollectionPolling.ts';

const SOURCES_MIN = 220;
const SOURCES_MAX = 420;
const SOURCES_DEFAULT = 300;
const STUDIO_MIN = 300;
const STUDIO_MAX = 700;
const STUDIO_DEFAULT = 300;
const COLLAPSED_W = 48;
const CHAT_MIN_W = 480;
const HANDLE_W = 8; // 2 resize handles × 4px

export function AppShell() {
  const params = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const {
    sourcesPanelCollapsed,
    studioPanelCollapsed,
    layoutMode,
    collectionModalOpen,
  } = useUIStore();
  const setStudioFocus = useUIStore((s) => s.setStudioFocus);

  const activeTab = useStudioStore((s) => s.activeTab);
  const feedSourceId = useStudioStore((s) => s.feedSourceId);
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandedReportId = useStudioStore((s) => s.expandedReportId);
  const sources = useSourcesStore((s) => s.sources);
  const hasSelectedSource = sources.some((s) => s.selected);
  const feedHasPosts = activeTab === 'feed' && !!(feedSourceId || hasSelectedSource);

  const [sourcesW, setSourcesW] = useState(SOURCES_DEFAULT);
  const [studioW, setStudioW] = useState(STUDIO_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const dragging = useRef<'sources' | 'studio' | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  useCollectionPolling();

  // Fetch sessions list on mount
  useEffect(() => {
    useSessionStore.getState().fetchSessions();
  }, []);

  // Sync URL ↔ session state: URL is the source of truth for active session
  useEffect(() => {
    const sessionStore = useSessionStore.getState();
    const currentActiveId = sessionStore.activeSessionId;

    if (params.sessionId) {
      // URL has a session ID — restore it if it's different from the current active session
      if (currentActiveId !== params.sessionId) {
        sessionStore.restoreSession(params.sessionId).catch(() => {
          // Session not found (deleted or invalid) — redirect to home
          navigate('/', { replace: true });
        });
      }
    } else {
      // URL is root `/` — start a fresh session if we had one active
      if (currentActiveId) {
        sessionStore.startNewSession();
      }
    }
  }, [params.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to studio-focus mode when feed has content or artifact is opened
  const hasArtifactContent = (activeTab === 'artifacts' && artifacts.length > 0) || expandedReportId !== null;
  useEffect(() => {
    const shouldFocus = feedHasPosts || hasArtifactContent;
    if (shouldFocus && layoutMode === 'balanced') {
      setStudioFocus();
      const focusW = Math.min(STUDIO_MAX, Math.floor((window.innerWidth - COLLAPSED_W) / 2));
      setStudioW(focusW);
    }
  }, [feedHasPosts, hasArtifactContent, layoutMode, setStudioFocus]);

  const onMouseDown = useCallback((panel: 'sources' | 'studio', e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = panel;
    startX.current = e.clientX;
    startW.current = panel === 'sources' ? sourcesW : studioW;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sourcesW, studioW]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;

      // Viewport-aware clamping: ensure chat keeps at least CHAT_MIN_W
      const { sourcesPanelCollapsed: srcCol, studioPanelCollapsed: stdCol } = useUIStore.getState();

      if (dragging.current === 'sources') {
        const otherW = stdCol ? COLLAPSED_W : studioW;
        const maxAvailable = window.innerWidth - otherW - CHAT_MIN_W - HANDLE_W;
        const max = Math.min(SOURCES_MAX, maxAvailable);
        setSourcesW(Math.max(SOURCES_MIN, Math.min(max, startW.current + dx)));
      } else {
        const otherW = srcCol ? COLLAPSED_W : sourcesW;
        const maxAvailable = window.innerWidth - otherW - CHAT_MIN_W - HANDLE_W;
        const max = Math.min(STUDIO_MAX, maxAvailable);
        setStudioW(Math.max(STUDIO_MIN, Math.min(max, startW.current - dx)));
      }
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = null;
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [sourcesW, studioW]);

  const transitionStyle = isResizing ? undefined : { transition: 'width 200ms ease' };

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sessions Panel */}
        <aside
          className="shrink-0 overflow-hidden bg-card"
          style={{
            width: sourcesPanelCollapsed ? COLLAPSED_W : sourcesW,
            ...transitionStyle,
          }}
        >
          <SessionsPanel />
        </aside>

        {/* Sources resize handle */}
        {!sourcesPanelCollapsed && (
          <div
            className="group relative z-10 w-1 shrink-0 cursor-col-resize"
            onMouseDown={(e) => onMouseDown('sources', e)}
          >
            <div className="absolute inset-y-0 -left-px w-[3px] bg-transparent transition-colors group-hover:bg-primary/20 group-active:bg-primary/40" />
          </div>
        )}

        {/* Chat Panel */}
        <ChatPanel />

        {/* Studio resize handle */}
        {!studioPanelCollapsed && (
          <div
            className="group relative z-10 w-1 shrink-0 cursor-col-resize"
            onMouseDown={(e) => onMouseDown('studio', e)}
          >
            <div className="absolute inset-y-0 -right-px w-[3px] bg-transparent transition-colors group-hover:bg-primary/20 group-active:bg-primary/40" />
          </div>
        )}

        {/* Studio Panel */}
        <aside
          className="shrink-0 bg-card"
          style={{
            width: studioPanelCollapsed ? COLLAPSED_W : studioW,
            ...transitionStyle,
          }}
        >
          <StudioPanel />
        </aside>
      </div>

      {/* Collection Modal Overlay */}
      {collectionModalOpen && <CollectionModal />}
    </div>
  );
}
