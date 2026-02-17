import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { TopBar } from './TopBar.tsx';
import { useUIStore } from '../stores/ui-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { ChatPanel } from '../features/chat/ChatPanel.tsx';
import { SourcesPanel } from '../features/sources/SourcesPanel.tsx';
import { StudioPanel } from '../features/studio/StudioPanel.tsx';
import { CollectionModal } from '../features/sources/CollectionModal.tsx';
import { useCollectionPolling } from '../features/sources/useCollectionPolling.ts';

const SOURCES_MIN = 220;
const SOURCES_MAX = 420;
const SOURCES_DEFAULT = 320;
const STUDIO_MIN = 300;
const STUDIO_MAX = 700;
const STUDIO_DEFAULT = 320;
const STUDIO_FEED_W = 440;
const COLLAPSED_W = 48;

export function AppShell() {
  const params = useParams<{ id?: string }>();
  const {
    sourcesPanelCollapsed,
    studioPanelCollapsed,
    collectionModalOpen,
  } = useUIStore();

  const activeTab = useStudioStore((s) => s.activeTab);
  const feedSourceId = useStudioStore((s) => s.feedSourceId);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const sources = useSourcesStore((s) => s.sources);
  const toggleSelected = useSourcesStore((s) => s.toggleSelected);
  const deselectAll = useSourcesStore((s) => s.deselectAll);
  const hasSelectedSource = sources.some((s) => s.selected);
  const feedHasPosts = activeTab === 'feed' && !!(feedSourceId || hasSelectedSource);

  const [sourcesW, setSourcesW] = useState(SOURCES_DEFAULT);
  const [studioW, setStudioW] = useState(STUDIO_DEFAULT);
  const userResizedStudio = useRef(false);
  const dragging = useRef<'sources' | 'studio' | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  useCollectionPolling();

  // Sync URL params with studio store (for page refresh/direct links)
  useEffect(() => {
    if (params.id) {
      // Collection is selected via URL - ensure state matches
      if (params.id !== feedSourceId) {
        setFeedSource(params.id);
        setActiveTab('feed');
      }

      // Ensure ONLY this collection is selected
      const source = sources.find((s) => s.collectionId === params.id);
      if (source) {
        // Check if other collections are selected
        const hasOtherSelected = sources.some(
          (s) => s.selected && s.collectionId !== params.id
        );

        // Deselect all if there are other selections
        if (hasOtherSelected) {
          deselectAll();
        }

        // Ensure this collection is selected
        if (!source.selected) {
          toggleSelected(params.id);
        }
      }
    } else {
      // No collection in URL - clear selection and feed
      if (feedSourceId) {
        setFeedSource(null);
      }
      // Deselect all collections when navigating to home
      if (hasSelectedSource) {
        deselectAll();
      }
    }
  }, [params.id, feedSourceId, sources, hasSelectedSource, setFeedSource, setActiveTab, toggleSelected, deselectAll]);

  // Auto-adjust studio width when feed state changes (unless user manually resized)
  useEffect(() => {
    if (userResizedStudio.current) return;
    setStudioW(feedHasPosts ? STUDIO_FEED_W : STUDIO_DEFAULT);
  }, [feedHasPosts]);

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
        userResizedStudio.current = true;
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
