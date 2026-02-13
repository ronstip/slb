import { PanelRightClose, PanelRightOpen, FileText, BarChart3, Presentation, FileDown, Sparkles } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { FeedTab } from './FeedTab.tsx';
import { ArtifactsTab } from './ArtifactsTab.tsx';

export function StudioPanel() {
  const collapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleStudioPanel);
  const activeTab = useStudioStore((s) => s.activeTab);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const { sendMessage } = useSSEChat();

  const actionButtons = [
    { label: 'Insight Report', icon: FileText, enabled: true, onClick: () => sendMessage('Generate an insight report for the selected sources.') },
    { label: 'Slide Deck', icon: Presentation, enabled: false },
    { label: 'Comparison Chart', icon: BarChart3, enabled: false },
    { label: 'Data Export', icon: FileDown, enabled: false },
    { label: 'Custom...', icon: Sparkles, enabled: false },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default/60 px-3 py-2">
        <button
          onClick={toggle}
          className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-surface-secondary hover:text-text-secondary"
        >
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </button>
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Studio
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 border-b border-border-default/60 p-3">
            {actionButtons.map(({ label, icon: Icon, enabled, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={!enabled}
                title={enabled ? undefined : 'Coming soon'}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all ${
                  enabled
                    ? 'border-border-default/50 bg-bg-surface text-text-primary shadow-sm hover:border-accent/40 hover:text-accent hover:shadow-md'
                    : 'border-border-default/30 bg-bg-surface-secondary text-text-tertiary cursor-not-allowed'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-default/60">
            <button
              onClick={() => setActiveTab('feed')}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === 'feed'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Feed
            </button>
            <button
              onClick={() => setActiveTab('artifacts')}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === 'artifacts'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Artifacts
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'feed' ? <FeedTab /> : <ArtifactsTab />}
          </div>
        </div>
      )}
    </div>
  );
}
