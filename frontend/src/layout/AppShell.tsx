import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './TopBar.tsx';
import { useUIStore } from '../stores/ui-store.ts';
import { ChatPanel } from '../features/chat/ChatPanel.tsx';
import { SourcesPanel } from '../features/sources/SourcesPanel.tsx';
import { StudioPanel } from '../features/studio/StudioPanel.tsx';
import { CollectionModal } from '../features/sources/CollectionModal.tsx';
import { useCollectionPolling } from '../features/sources/useCollectionPolling.ts';

const SOURCES_MIN = 220;
const SOURCES_MAX = 420;
const SOURCES_DEFAULT = 280;
const STUDIO_MIN = 300;
const STUDIO_MAX = 700;
const STUDIO_DEFAULT = 520;
const COLLAPSED_W = 48;

export function AppShell() {
  const {
    sourcesPanelCollapsed,
    studioPanelCollapsed,
    collectionModalOpen,
  } = useUIStore();

  const [sourcesW, setSourcesW] = useState(SOURCES_DEFAULT);
  const [studioW, setStudioW] = useState(STUDIO_DEFAULT);
  const dragging = useRef<'sources' | 'studio' | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  useCollectionPolling();

  const onMouseDown = useCallback((panel: 'sources' | 'studio', e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = panel;
    startX.current = e.clientX;
    startW.current = panel === 'sources' ? sourcesW : studioW;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sourcesW, studioW]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      if (dragging.current === 'sources') {
        setSourcesW(Math.max(SOURCES_MIN, Math.min(SOURCES_MAX, startW.current + dx)));
      } else {
        setStudioW(Math.max(STUDIO_MIN, Math.min(STUDIO_MAX, startW.current - dx)));
      }
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = null;
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
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sources Panel */}
        <aside
          className="shrink-0 overflow-hidden bg-card"
          style={{ width: sourcesPanelCollapsed ? COLLAPSED_W : sourcesW }}
        >
          <SourcesPanel />
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
          style={{ width: studioPanelCollapsed ? COLLAPSED_W : studioW }}
        >
          <StudioPanel />
        </aside>
      </div>

      {/* Collection Modal Overlay */}
      {collectionModalOpen && <CollectionModal />}
    </div>
  );
}
