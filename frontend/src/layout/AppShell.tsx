import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUIStore } from '../stores/ui-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { ChatPanel } from '../features/chat/ChatPanel.tsx';
import { SessionsPanel } from '../features/sessions/SessionsPanel.tsx';
import { StudioPanel } from '../features/studio/StudioPanel.tsx';
import { CollectionModal } from '../features/sources/CollectionModal.tsx';
import { CollectionsLibrary } from '../features/collections/CollectionsLibrary.tsx';
import { useCollectionPolling } from '../features/sources/useCollectionPolling.ts';

const SOURCES_MIN = 220;
const SOURCES_MAX = 420;
const SOURCES_DEFAULT = 300;
const STUDIO_MIN = 300;
const STUDIO_MAX = 1000;
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

  // Determine which expanded artifact type is active (if any)
  const expandedArtifact = expandedReportId ? artifacts.find((a) => a.id === expandedReportId) : null;
  const isDashboardOpen = expandedArtifact?.type === 'dashboard';
  const isDataExportOpen = expandedArtifact?.type === 'data_export';
  const isNonDashboardArtifactOpen = expandedReportId !== null && !isDashboardOpen && !isDataExportOpen;

  // Full-width artifacts: dashboard and data export table
  const showFullWidth = (isDashboardOpen || isDataExportOpen) && activeTab === 'artifacts';

  // Auto-resize studio panel based on content type
  useEffect(() => {
    const srcW = sourcesPanelCollapsed ? COLLAPSED_W : sourcesW;
    const maxAvailable = window.innerWidth - srcW - CHAT_MIN_W - HANDLE_W;

    if (showFullWidth) {
      // Dashboard / Data Export table → as wide as viewport allows (up to 1000px)
      if (layoutMode === 'balanced') setStudioFocus();
      setStudioW(Math.min(STUDIO_MAX, Math.max(STUDIO_MIN, maxAvailable)));
    } else if (feedHasPosts || isNonDashboardArtifactOpen) {
      // Feed with posts or expanded non-dashboard artifact → 50:50 with chat
      if (layoutMode === 'balanced') setStudioFocus();
      const halfW = Math.min(STUDIO_MAX, Math.floor((window.innerWidth - COLLAPSED_W) / 2));
      setStudioW(Math.min(halfW, maxAvailable));
    } else {
      // Artifacts menu list / no content → default width
      setStudioW(STUDIO_DEFAULT);
    }
  }, [feedHasPosts, isNonDashboardArtifactOpen, showFullWidth, layoutMode, setStudioFocus, sourcesPanelCollapsed, sourcesW]);

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

  // Skip transition when auto-expanding to full width so table-fixed layouts
  // calculate their column widths against the final container size immediately.
  const transitionStyle = isResizing || showFullWidth ? undefined : { transition: 'width 200ms ease' };

  // Ctrl+K to open session search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useUIStore.getState().openSessionSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sessions Panel (sidebar) */}
      <aside
        className={`shrink-0 overflow-hidden bg-card ${sourcesPanelCollapsed ? 'border-r border-border' : ''}`}
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
        className="shrink-0 overflow-hidden bg-card"
        style={{
          width: studioPanelCollapsed ? COLLAPSED_W : studioW,
          ...transitionStyle,
        }}
      >
        <StudioPanel />
      </aside>

      {/* Collection Modal Overlay */}
      {collectionModalOpen && <CollectionModal />}

      {/* Collections Library Drawer */}
      <CollectionsLibrary />
    </div>
  );
}
